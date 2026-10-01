import React from 'react';
import WalletConnector from './components/WalletConnector';

const App: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <main className="w-full max-w-md flex flex-col items-center">
        <WalletConnector />
      </main>
    </div>
  );
};

export default App;
