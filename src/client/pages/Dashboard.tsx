import React, { useState } from 'react';
import { Shield } from 'lucide-react';
import SidebarInfo from '../components/SidebarInfo';
import AuditorWidget from '../components/AuditorWidget';

const Dashboard: React.FC = () => {
  const [walletAddress, setWalletAddress] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState<'BNB' | 'TRON' | null>(null);

  return (
    <div className="min-h-[100svh] overflow-x-hidden px-3 py-5 sm:px-6 sm:py-8 crypto-bg">
      <div className="crypto-grid"></div>
      <div className="crypto-accent-tl"></div>
      <div className="crypto-accent-br"></div>
      
      <div className="crypto-content mx-auto grid w-full max-w-6xl min-w-0 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,430px)] lg:items-start">
        <SidebarInfo />
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#f0b90b] flex items-center justify-center shadow-md shadow-[#f0b90b]/30">
                <Shield className="w-4 h-4 text-black" strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-none tracking-tight">Multi-Chain Wallet Auditor</p>
                <p className="text-[#4a5568] text-[10px] mt-0.5 font-mono">v2.4.1 · BNB + TRON</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-500/10 border border-green-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-green-400 font-mono text-[10px] font-medium tracking-wider">ONLINE</span>
            </div>
          </div>
          
          <AuditorWidget 
            walletAddress={walletAddress}
            setWalletAddress={setWalletAddress}
            selectedNetwork={selectedNetwork}
            setSelectedNetwork={setSelectedNetwork}
          />
        </div>
      </div>
      
      <p className="crypto-content text-center text-[#2a3444] text-[10px] mt-4 font-mono tracking-wide">
        MetaMask · Trust Wallet · Binance Wallet · WalletConnect
      </p>
    </div>
  );
};

export default Dashboard;
