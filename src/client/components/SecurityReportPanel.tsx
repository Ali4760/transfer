import React from 'react';
import { ShieldCheck, ArrowLeft, Lock, CheckCircle2, XCircle } from 'lucide-react';

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
  checks: Array<{ label: string; passed: boolean }>;
}

interface Props {
  network: 'BNB' | 'TRON';
  reportData: SecurityReport;
  onReset: () => void;
}

const SecurityReportPanel: React.FC<Props> = ({ network, reportData, onReset }) => {
  const themeColor = network === 'BNB' ? '#f0b90b' : '#eb0029';
  const isHighRisk = reportData.riskLevel === 'HIGH';
  const statusColor = isHighRisk ? '#eb0029' : '#10b981';

  return (
    <div className="bg-[#111520] relative w-full h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-[#1e2636] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${themeColor}15`, borderColor: `${themeColor}30`, borderWidth: 1 }}>
            <ShieldCheck className="w-5 h-5" style={{ color: themeColor }} />
          </div>
          <div>
            <h1 className="text-white font-bold text-[15px] tracking-tight leading-snug">Security Report Complete</h1>
            <p className="text-[#4a5568] text-[11px] mt-0.5 leading-relaxed font-mono">ID: {reportData.id}</p>
          </div>
        </div>
        <button onClick={onReset} className="p-2 rounded-lg bg-[#1e2636] hover:bg-[#2a3444] text-[#94a3b8] transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 overflow-y-auto custom-scrollbar flex-1">
        {/* Metrics Cards */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-[#0d1119] rounded-xl p-4 border border-[#1e2636]">
            <p className="text-[#7b879b] text-[10px] font-medium uppercase tracking-widest font-mono mb-2">Security Score</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white tracking-tight">{reportData.score}</span>
              <span className="text-[#4a5568] text-sm font-bold">/100</span>
            </div>
            <p className="text-xs mt-1 font-medium" style={{ color: statusColor }}>{reportData.scoreLabel}</p>
          </div>
          <div className="bg-[#0d1119] rounded-xl p-4 border border-[#1e2636]">
            <p className="text-[#7b879b] text-[10px] font-medium uppercase tracking-widest font-mono mb-2">Balance Status</p>
            <div className="flex items-center h-full pb-6">
              <span className="text-sm font-semibold text-white">{reportData.balance}</span>
            </div>
          </div>
        </div>

        {/* Summary Row */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          <div className="bg-[#0d1119] rounded-lg px-3 py-2.5 border border-[#1e2636] flex flex-col items-center justify-center text-center">
            <span className="text-[#4a5568] text-[9px] font-medium uppercase tracking-widest font-mono mb-1">Risk Level</span>
            <span className="font-bold text-xs" style={{ color: statusColor }}>{reportData.riskLevel}</span>
          </div>
          <div className="bg-[#0d1119] rounded-lg px-3 py-2.5 border border-[#1e2636] flex flex-col items-center justify-center text-center">
            <span className="text-[#4a5568] text-[9px] font-medium uppercase tracking-widest font-mono mb-1">Threats</span>
            <span className="font-bold text-xs text-white">{reportData.threatsFound}</span>
          </div>
          <div className="bg-[#0d1119] rounded-lg px-3 py-2.5 border border-[#1e2636] flex flex-col items-center justify-center text-center">
            <span className="text-[#4a5568] text-[9px] font-medium uppercase tracking-widest font-mono mb-1">Checks</span>
            <span className="font-bold text-xs text-white">{reportData.checksPassed}/{reportData.totalChecks}</span>
          </div>
        </div>

        {/* Metadata Table */}
        <div className="bg-[#0d1119] rounded-xl border border-[#1e2636] mb-5 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1e2636] flex justify-between items-center bg-[#111520]/50">
            <span className="text-[#7b879b] text-xs font-medium">Wallet Address</span>
            <span className="text-white font-mono text-[10px] truncate max-w-[150px]">{reportData.address}</span>
          </div>
          <div className="px-4 py-3 border-b border-[#1e2636] flex justify-between items-center">
            <span className="text-[#7b879b] text-xs font-medium">Network</span>
            <span className="text-white font-mono text-xs">{reportData.network}</span>
          </div>
          <div className="px-4 py-3 flex justify-between items-center">
            <span className="text-[#7b879b] text-xs font-medium">Timestamp</span>
            <span className="text-white font-mono text-[10px]">{new Date(reportData.timestamp).toLocaleString()}</span>
          </div>
        </div>

        {/* Security Checks */}
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-[#7b879b] mb-3">Security Checks</p>
          <div className="space-y-2">
            {reportData.checks.map((check, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-[#0d1119] border border-[#1e2636]">
                {check.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-[#10b981]" />
                ) : (
                  <XCircle className="w-4 h-4 text-[#eb0029]" />
                )}
                <span className="text-sm text-white font-medium">{check.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-3 border-t border-[#1e2636] bg-[#0d1119] mt-auto">
        <div className="flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-[#2a3444]" />
          <span className="text-[#2a3444] text-[10px] font-mono">End-to-End Encrypted</span>
        </div>
      </div>
    </div>
  );
};

export default SecurityReportPanel;
