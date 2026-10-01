import React from 'react';
import Header from './components/Header';
import WalletConnector from './components/WalletConnector';

const App: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col items-center p-4 bg-gray-50">
      <Header />
      <main className="flex-1 w-full max-w-md flex flex-col items-center mt-8">
        <WalletConnector />
      </main>
    </div>
  );
};

export default App;
