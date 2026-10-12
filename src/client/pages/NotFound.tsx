// src/client/pages/NotFound.tsx
import React from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

interface NotFoundProps {
  onNavigateHome?: () => void;
}

export const NotFound: React.FC<NotFoundProps> = ({ onNavigateHome }) => {
  const handleGoHome = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Background glow effects */}
      <div className="absolute w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute w-[300px] h-[300px] bg-red-600/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-md w-full bg-[#0d1424]/90 border border-[#1e2a3f] rounded-3xl p-8 text-center shadow-2xl backdrop-blur-xl">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6 shadow-inner">
          <ShieldAlert className="w-8 h-8 text-red-400" />
        </div>

        <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-blue-400 font-mono tracking-wider mb-2">
          404
        </h1>

        <h2 className="text-xl font-bold text-white mb-2">
          Page Not Found
        </h2>

        <p className="text-sm text-[#8e9eb3] mb-8 leading-relaxed">
          The requested URL does not exist or has been moved. Verify the address and try again.
        </p>

        <button
          onClick={handleGoHome}
          className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-all shadow-lg shadow-blue-600/30 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Homepage</span>
        </button>
      </div>

      <div className="mt-8 text-xs text-[#4a5568] font-mono">
        Error 404 · Resource Not Found
      </div>
    </div>
  );
};

export default NotFound;
