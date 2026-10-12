// src/client/context/AdminDataContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

export interface WalletDoc {
  id: string;
  status: string;
  sponsoredAt?: Timestamp;
  sponsorTxHash?: string;
  createdAt?: string;
}

export interface TwoDayStats {
  total: number;
  successful: number;
  unlimitedGranted: number;
}

interface AdminDataContextType {
  allWallets: WalletDoc[];
  twoDayStats: TwoDayStats | null;
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

function startOf48hAgo(): Timestamp {
  return Timestamp.fromMillis(Date.now() - 48 * 60 * 60 * 1000);
}

export const AdminDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [allWallets, setAllWallets] = useState<WalletDoc[]>([]);
  const [twoDayStats, setTwoDayStats] = useState<TwoDayStats | null>(null);
  const [isWalletsLoaded, setIsWalletsLoaded] = useState(false);
  const [isRescuesLoaded, setIsRescuesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    // 2. Real-time listener for rescues in the last 48 hours
    const cutoff = startOf48hAgo();
    const rescuesQuery = query(
      collection(db, 'rescues'),
      where('createdAt', '>=', cutoff)
    );

    const unsubRescues = onSnapshot(
      rescuesQuery,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => doc.data());
        setTwoDayStats({
          total: docs.length,
          successful: docs.filter((d) => d.status === 'CONFIRMED').length,
          unlimitedGranted: docs.filter(
            (d) => d.status === 'CONFIRMED' && d.amount && d.amount !== '0'
          ).length,
        });
        setIsRescuesLoaded(true);
      },
      (err) => {
        console.error('AdminDataContext rescues listener error:', err);
        // Do not overwrite main error if wallets succeeded
        setIsRescuesLoaded(true);
      }
    );

    // Clean up real-time listeners on unmount
    return () => {
      unsubWallets();
      unsubRescues();
    };
  }, []);

  // ── Derived metrics computed client-side from wallet stream ─────────
  const connectedCount = allWallets.length;

  const unlimitedTodayCount = useMemo(() => {
    const todayCutoff = startOfToday().toMillis();
    return allWallets.filter((w) => {
      if (!w.sponsoredAt) return false;
      const ms = w.sponsoredAt.toMillis?.() ?? 0;
      return ms >= todayCutoff;
    }).length;
  }, [allWallets]);

  const isLoading = !isWalletsLoaded || !isRescuesLoaded;

  return (
    <AdminDataContext.Provider
      value={{
        allWallets,
        twoDayStats,
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
