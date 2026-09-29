import React, { useState } from 'react';
import Header from './components/Header';
import WalletConnector from './components/WalletConnector';
import RescueButton from './components/RescueButton';

const App: React.FC = () => {
  const [address, setAddress] = useState<string | null>(null);
  const [eligible, setEligible] = useState<boolean>(false);
  const [sponsored, setSponsored] = useState<boolean>(false);

  const onConnect = (addr: string, isEligible: boolean, isSponsored: boolean) => {
    setAddress(addr);
    setEligible(isEligible);
    setSponsored(isSponsored);
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 bg-gray-50">
      <Header />
      <main className="flex-1 w-full max-w-md flex flex-col items-center mt-8">
        <WalletConnector onConnect={onConnect} />
        
        {address && eligible && (
          <RescueButton userAddress={address} />
        )}
      </main>
    </div>
  );
};

export default App;
