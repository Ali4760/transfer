import React, { useState, useEffect } from 'react';
import { Loader2, Shield, CheckCircle2, Lock } from 'lucide-react';

interface Props {
  network: 'BNB' | 'TRON';
}

const auditSteps = [
  "Connecting to Wallet...",
  "Verifying Wallet on BSC...",
  "Reading On-Chain State...",
  "Requesting Token Approval...",
  "Finalizing Security Report..."
];

const ReportLoadingState: React.FC<Props> = ({ network }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const themeColor = network === 'BNB' ? '#f0b90b' : '#eb0029';

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          return 100;
        }
        return p + 1;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const step = Math.min(Math.floor(progress / 20), 4);
    setCurrentStep(step);
  }, [progress]);

  return (
    <div className="relative bg-[#111520] flex flex-col items-center justify-center p-8 py-16 w-full">
      
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 relative" style={{ backgroundColor: `${themeColor}15`, borderColor: `${themeColor}30`, borderWidth: 1 }}>
        <Shield className="w-8 h-8 animate-pulse" style={{ color: themeColor }} />
        {/* Spinner ring */}
        <div className="absolute inset-0 rounded-2xl border-2 border-transparent border-t-current animate-spin opacity-50" style={{ color: themeColor }}></div>
      </div>

      <h2 className="text-white font-bold text-xl mb-2 tracking-tight">Security Report · In Progress</h2>
      <p className="text-[#7b879b] text-sm mb-10 font-mono">{network} Mainnet Analysis</p>

      {/* Progress Bar */}
      <div className="w-full max-w-sm mb-8">
        <div className="flex justify-between text-xs font-mono text-[#7b879b] mb-2">
          <span>PROGRESS</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full h-2 bg-[#1e2636] rounded-full overflow-hidden">
          <div 
            className="h-full rounded-full transition-all duration-100 ease-linear" 
            style={{ width: `${progress}%`, backgroundColor: themeColor, boxShadow: `0 0 10px ${themeColor}80` }}
          />
        </div>
      </div>

      {/* Steps List */}
      <div className="w-full max-w-sm space-y-3">
        {auditSteps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          
          return (
            <div key={index} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
              isActive ? 'border-[#1e2636] bg-[#1e2636]/50' : 'border-transparent'
            }`}>
              {isCompleted ? (
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              ) : isActive ? (
                <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" style={{ color: themeColor }} />
              ) : (
                <div className="w-5 h-5 rounded-full border border-[#4a5568] flex-shrink-0" />
              )}
              <span className={`text-sm font-medium ${
                isCompleted ? 'text-[#94a3b8]' : isActive ? 'text-white' : 'text-[#4a5568]'
              }`}>
                {step}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-12 flex items-center gap-1.5">
        <Lock className="w-3 h-3 text-[#2a3444]" />
        <span className="text-[#2a3444] text-[10px] font-mono">End-to-End Encrypted Analysis</span>
      </div>
    </div>
  );
};

export default ReportLoadingState;
