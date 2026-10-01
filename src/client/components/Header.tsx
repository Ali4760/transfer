// src/client/components/Header.tsx
import React from 'react';

const Header: React.FC = () => {
  return (
    <header className="w-full flex items-center justify-between py-4 mb-6 border-b border-gray-300">
      <h1 className="text-2xl font-semibold text-primary">BSC USDT Rescue</h1>
    </header>
  );
};

export default Header;
