import React from 'react';

const SidebarInfo: React.FC = () => {
  return (
    <section className="hidden min-h-[520px] flex-col justify-between rounded-2xl border border-[#1e2636] bg-[#0d1119]/80 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)] lg:flex">
      <div>
        <div className="mb-10 flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-[#f0b90b] shadow-[0_0_14px_rgba(240,185,11,0.8)]"></div>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7b879b]">
            Multi-chain security console
          </span>
        </div>
        <h1 className="max-w-xl text-5xl font-semibold leading-[1.05] tracking-[-0.04em] text-white xl:text-6xl">
          One report.<br />
          <span className="text-[#f0b90b]">Two networks.</span>
        </h1>
        <p className="mt-6 max-w-md text-sm leading-7 text-[#7b879b]">
          Inspect wallet security, token balances, and verification signals across BNB Smart Chain and TRON Mainnet from one precise, read-only workspace.
        </p>
      </div>
      
      <div>
        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="rounded-xl border border-[#f0b90b]/20 bg-[#f0b90b]/5 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#f0b90b]">BNB</p>
            <p className="mt-2 text-xs text-[#b1bac9]">BEP-20 asset reporting</p>
          </div>
          <div className="rounded-xl border border-[#eb0029]/20 bg-[#eb0029]/5 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#ff4d67]">TRON</p>
            <p className="mt-2 text-xs text-[#b1bac9]">TRC-20 asset reporting</p>
          </div>
        </div>
        <div className="chain-dual-line h-px bg-[#1e2636]"></div>
      </div>
    </section>
  );
};

export default SidebarInfo;
