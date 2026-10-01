import { useState } from "react";

interface WalletConnectorProps {
  onConnect: (addr: string, isEligible: boolean, isSponsored: boolean) => void;
}

export default function WalletConnector({ onConnect }: WalletConnectorProps) {
  const [wallet, setWallet] = useState<string | null>(null);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [sponsored, setSponsored] = useState<boolean>(false);
  const [sponsorTx, setSponsorTx] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (!window.ethereum) {
      alert("MetaMask (or another web3 wallet) is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const addr = accounts[0];
      setWallet(addr);

      // 👉 Ask the backend if this address is eligible
      const resp = await fetch(
        `${import.meta.env.VITE_API_BASE}/checkEligibility`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: addr }),
        }
      );
      const data = await resp.json();
      
      setEligible(data.eligible);
      setSponsored(data.sponsored ?? false);
      setSponsorTx(data.sponsorTxHash ?? null);
      
      onConnect(addr, data.eligible, data.sponsored ?? false);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-6 rounded-lg shadow-md w-full">
      <button 
        onClick={connect} 
        disabled={loading}
        className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {wallet && (
        <div className="text-sm text-gray-700 text-center">
          <p>Connected: <code className="bg-gray-100 p-1 rounded break-all">{wallet}</code></p>
        </div>
      )}
      {eligible === false && (
        <p className="text-red-600 font-medium">🚫 This address is not eligible for sponsorship.</p>
      )}
      {eligible && !sponsored && sponsorTx && (
        <p className="text-green-600 font-medium">🟡 Sponsorship sent! Tx: {sponsorTx}</p>
      )}
    </div>
  );
}
