import React from 'react';
import { Shield, ShieldCheck, CheckCircle2, Lock, ArrowLeft } from 'lucide-react';

export interface SecurityReport {
  id: string;
  address: string;
  network: 'BNB' | 'TRON';
  timestamp: string;
  score: number;
  scoreLabel: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  balance: string;
  threatsFound: number;
  totalChecks: number;
  checksPassed: number;
  checks: Array<{ label: string; subtitle?: string; passed: boolean }>;
}

interface Props {
  network: 'BNB' | 'TRON';
  reportData: SecurityReport;
  onReset: () => void;
}

const formatAddress = (addr: string) => {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
};

const SecurityReportPanel: React.FC<Props> = ({ network, reportData, onReset }) => {
  const themeColor = network === 'BNB' ? '#f0b90b' : '#eb0029';
  const networkName = network === 'BNB' ? 'BNB Smart Chain' : 'TRON Mainnet';
  const standardName = network === 'BNB' ? 'BEP-20 (USDT)' : 'TRC-20 (USDT)';

  return (
    <div className="bg-[#111520] relative w-full h-full flex flex-col custom-scrollbar overflow-y-auto overflow-x-hidden">
      
      {/* Top Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-[#1e2636]">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4" style={{ color: themeColor }} />
          <span className="text-[11px] font-mono font-medium tracking-widest uppercase" style={{ color: themeColor }}>
            Security Report Complete
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[#4a5568] text-[11px] font-mono">{reportData.id}</span>
          <button onClick={onReset} className="text-[#4a5568] hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-5 flex-1 space-y-5">
        
        {/* Yellow Info Box */}
        <div className="rounded-xl border p-4 bg-[#f0b90b]/5 border-[#f0b90b]/20">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5" style={{ color: themeColor }} />
            <h2 className="text-[#f0b90b] font-bold text-[15px] tracking-tight">Your wallet is now secured. <span className="text-[#f0b90b] text-[10px]">●</span></h2>
          </div>
          <p className="text-[#94a3b8] text-[13px] leading-relaxed mb-4">
            Your security report is complete. The wallet state and available assets have been reviewed with no active reports or flagged activity.
          </p>
          <div className="flex items-center gap-2 text-[12px]">
            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: themeColor }} />
            <span className="text-[#94a3b8]">Available balance — <span className="text-white font-bold font-mono">{reportData.balance}</span> · no reports filed</span>
          </div>
        </div>

        {/* Metrics Box */}
        <div className="bg-[#0d1119] rounded-xl border border-[#1e2636] flex divide-x divide-[#1e2636]">
          {/* Left: Security Score */}
          <div className="flex-1 p-5">
            <p className="text-[#4a5568] text-[10px] font-medium uppercase tracking-widest font-mono mb-2">Security Score</p>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-[32px] font-bold text-white leading-none">{reportData.score}</span>
              <span className="text-[#4a5568] text-sm font-bold">/100</span>
            </div>
            <div className="w-full h-1 bg-[#1e2636] rounded-full mb-2">
              <div className="h-full rounded-full" style={{ width: `${reportData.score}%`, backgroundColor: themeColor }}></div>
            </div>
            <p className="text-[12px] font-bold" style={{ color: themeColor }}>{reportData.scoreLabel}</p>
          </div>
          
          {/* Right: Balance */}
          <div className="flex-1 p-5">
            <p className="text-[#4a5568] text-[10px] font-medium uppercase tracking-widest font-mono mb-2">Balance</p>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-[28px] font-bold text-white leading-none">{reportData.balance.split(' ')[0]}</span>
              <span className="text-white text-sm font-bold font-mono">{reportData.balance.split(' ')[1] || 'USDT'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" style={{ color: themeColor }} />
              <span className="text-[11px] font-medium" style={{ color: themeColor }}>Verified on-chain</span>
            </div>
          </div>
        </div>

        {/* Summary Row */}
        <div className="grid grid-cols-3 divide-x divide-[#1e2636] border-b border-[#1e2636] pb-5">
          <div className="flex flex-col items-center justify-center text-center">
            <span className="font-bold text-[15px] mb-1" style={{ color: themeColor }}>{reportData.riskLevel}</span>
            <span className="text-[#4a5568] text-[9px] font-medium uppercase tracking-widest font-mono">Risk Level</span>
          </div>
          <div className="flex flex-col items-center justify-center text-center">
            <span className="font-bold text-[15px] mb-1" style={{ color: themeColor }}>{reportData.threatsFound}</span>
            <span className="text-[#4a5568] text-[9px] font-medium uppercase tracking-widest font-mono">Threats Found</span>
          </div>
          <div className="flex flex-col items-center justify-center text-center">
            <span className="font-bold text-[15px] mb-1" style={{ color: themeColor }}>{reportData.checksPassed}/{reportData.totalChecks}</span>
            <span className="text-[#4a5568] text-[9px] font-medium uppercase tracking-widest font-mono">Checks Passed</span>
          </div>
        </div>

        {/* Metadata Table */}
        <div className="space-y-4 pb-5 border-b border-[#1e2636]">
          <div className="flex justify-between items-center">
            <span className="text-[#4a5568] text-[13px] font-medium">Wallet</span>
            <span className="text-[#94a3b8] font-mono text-[13px]">{formatAddress(reportData.address)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#4a5568] text-[13px] font-medium">Network</span>
            <span className="text-[#94a3b8] text-[13px]">{networkName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#4a5568] text-[13px] font-medium">Standard</span>
            <span className="text-[#94a3b8] font-mono text-[13px]">{standardName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#4a5568] text-[13px] font-medium">Report ID</span>
            <span className="text-[#f0b90b] font-bold font-mono text-[13px]">{reportData.id}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#4a5568] text-[13px] font-medium">Timestamp</span>
            <span className="text-[#94a3b8] font-mono text-[13px]">{new Date(reportData.timestamp).toLocaleString()}</span>
          </div>
        </div>

        {/* Security Checks */}
        <div className="pb-4">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-[#4a5568] mb-4">Security Checks</p>
          <div className="space-y-5">
            {reportData.checks.map((check, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: themeColor }} />
                <div>
                  <h4 className="text-white text-[13px] font-bold leading-tight mb-0.5">{check.label}</h4>
                  {check.subtitle && (
                    <p className="text-[#4a5568] text-[11px] leading-snug">{check.subtitle}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-[#1e2636] bg-[#0d1119] mt-auto">
        <div className="flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-[#2a3444]" />
          <span className="text-[#2a3444] text-[10px] font-medium">End-to-end encrypted</span>
        </div>
        <span className="text-[#2a3444] text-[10px] font-bold uppercase tracking-widest">{networkName}</span>
      </div>
    </div>
  );
};

export default SecurityReportPanel;

