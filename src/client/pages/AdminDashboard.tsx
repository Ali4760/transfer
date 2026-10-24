// src/client/pages/AdminDashboard.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Shield,
  LogOut,
  Activity,
  ExternalLink,
  CheckCircle2,
  Zap,
  AlertTriangle,
  Loader2,
  Wallet,
  Clock,
  TrendingUp,
  Search,
  ChevronRight,
  X,
  RefreshCw,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, fns, SESSION_TIMEOUT_MS, SESSION_WARN_MS } from '../config/firebase';
import { useAdminData } from '../context/AdminDataContext';

interface AdminDashboardProps {
  onLogout: () => void;
  onNavigateHome?: () => void;
}

type SidebarTab = 'dashboard' | 'wallets';
type WalletFilter = 'all' | 'approved' | 'unapproved';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onLogout,
  onNavigateHome,
}) => {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('dashboard');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isRefreshingWallets, setIsRefreshingWallets] = useState(false);
  const [walletFilter, setWalletFilter] = useState<WalletFilter>('approved');
  const [checkingAllowanceId, setCheckingAllowanceId] = useState<string | null>(null);
  const [isCheckingAllAllowances, setIsCheckingAllAllowances] = useState(false);
  const [checkSuccessMsg, setCheckSuccessMsg] = useState<string | null>(null);

  // ── Security: Inactivity auto-logout ─────────────────────────────
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const [secondsUntilLogout, setSecondsUntilLogout] = useState(Math.round(SESSION_WARN_MS / 1000));
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const doSignOut = useCallback(async () => {
    try {
      await signOut(auth);
      onLogout();
    } catch (err) {
      console.error('[Security] Auto-logout error:', err);
    }
  }, [onLogout]);

  const clearAllTimers = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (warningTimer.current)    clearTimeout(warningTimer.current);
    if (countdownTimer.current)  clearInterval(countdownTimer.current);
  }, []);

  const resetInactivityTimer = useCallback(() => {
    clearAllTimers();
    setInactivityWarning(false);
    setSecondsUntilLogout(Math.round(SESSION_WARN_MS / 1000));

    // After (TIMEOUT - WARN) show the warning banner
    warningTimer.current = setTimeout(() => {
      setInactivityWarning(true);
      let secs = Math.round(SESSION_WARN_MS / 1000);
      setSecondsUntilLogout(secs);
      countdownTimer.current = setInterval(() => {
        secs -= 1;
        setSecondsUntilLogout(secs);
        if (secs <= 0) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
        }
      }, 1000);
    }, SESSION_TIMEOUT_MS - SESSION_WARN_MS);

    // After full TIMEOUT, sign out automatically
    inactivityTimer.current = setTimeout(() => {
      doSignOut();
    }, SESSION_TIMEOUT_MS);
  }, [clearAllTimers, doSignOut]);

  // Attach activity listeners on mount; reset timer on any user interaction
  useEffect(() => {
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;
    const handleActivity = () => resetInactivityTimer();
    ACTIVITY_EVENTS.forEach(evt => document.addEventListener(evt, handleActivity, { passive: true }));
    resetInactivityTimer(); // start the first timer
    return () => {
      ACTIVITY_EVENTS.forEach(evt => document.removeEventListener(evt, handleActivity));
      clearAllTimers();
    };
  }, [resetInactivityTimer, clearAllTimers]);

  // ── Real-time state from shared AdminDataContext ─────────────────
  const {
    allWallets,
    sortedWallets,
    approvedWallets,
    unapprovedWallets,
    totalBalanceRescued,
    todayBalanceRescued,
    connectedCount,
    unlimitedTodayCount,
    latestSweepsMap,
    balances,
    refreshBalance,
    refreshAllBalances,
    recordLocalSweep,
    markWalletUnapproved,
    checkWalletAllowanceOnChain,
    checkAllUnapprovedOnChain,
    isLoading: metricsLoading,
    error: metricsError,
  } = useAdminData();

  // ── Sweep execution state ─────────────────────────────────────────
  const [sweepAddress, setSweepAddress] = useState('');
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepingId, setSweepingId] = useState<string | null>(null); // per-row tracking
  const [refreshingWalletId, setRefreshingWalletId] = useState<string | null>(null); // per-wallet balance refresh tracking
  const [sweepResult, setSweepResult] = useState<{
    success: boolean;
    message: string;
    txHash?: string;
  } | null>(null);

  // ── Sign out handler ──────────────────────────────────────────────
  const handleSignOut = async () => {
    clearAllTimers();
    setIsLoggingOut(true);
    try {
      await signOut(auth);
      onLogout();
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  // ── Manual refresh handler for Wallets page (in-place seamless update with guaranteed visible animation) ──
  const handleRefreshWallets = async () => {
    setIsRefreshingWallets(true);
    const minDelay = new Promise((resolve) => setTimeout(resolve, 800));
    try {
      await Promise.all([refreshAllBalances(), minDelay]);
    } catch (err) {
      console.error('Refresh wallets error:', err);
      await minDelay;
    } finally {
      setIsRefreshingWallets(false);
    }
  };

  // ── Single wallet balance refresh handler ──────────────────────────
  const handleRefreshSingleBalance = async (address: string) => {
    setRefreshingWalletId(address);
    const minDelay = new Promise((resolve) => setTimeout(resolve, 700));
    try {
      await Promise.all([refreshBalance(address), minDelay]);
    } catch (err) {
      console.error('Failed to refresh balance for', address, err);
      await minDelay;
    } finally {
      setRefreshingWalletId((prev) => (prev === address ? null : prev));
    }
  };

  // ── Single on-chain allowance check ───────────────────────────────
  const handleCheckAllowance = async (address: string) => {
    setCheckingAllowanceId(address);
    setCheckSuccessMsg(null);
    try {
      const isApproved = await checkWalletAllowanceOnChain(address);
      if (isApproved) {
        setCheckSuccessMsg(
          `Wallet ${address.slice(0, 10)}… verified active approval! Automatically moved to Approved Wallets.`
        );
      } else {
        setCheckSuccessMsg(
          `Wallet ${address.slice(0, 10)}… currently has 0 on-chain allowance.`
        );
      }
      setTimeout(() => setCheckSuccessMsg(null), 6000);
    } catch (err) {
      console.error('Allowance check error:', err);
    } finally {
      setCheckingAllowanceId(null);
    }
  };

  // ── Batch on-chain allowance check for ALL non-approved wallets ────
  const handleCheckAllAllowances = async () => {
    setIsCheckingAllAllowances(true);
    setCheckSuccessMsg(null);
    try {
      const res = await checkAllUnapprovedOnChain();
      if (res.reapprovedCount > 0) {
        setCheckSuccessMsg(
          `RPC scan complete: Checked ${res.checkedCount} wallets. ${res.reapprovedCount} newly approved wallet(s) found and moved to Approved Wallets!`
        );
      } else {
        setCheckSuccessMsg(
          `RPC scan complete: Checked ${res.checkedCount} non-approved wallet(s) on-chain. All still have 0 allowance.`
        );
      }
      setTimeout(() => setCheckSuccessMsg(null), 8000);
    } catch (err) {
      console.error('Check all on-chain error:', err);
    } finally {
      setIsCheckingAllAllowances(false);
    }
  };

  // ── Sweep action (shared handler for manual input + per-wallet row) ─
  const executeSweep = useCallback(
    async (address: string, rowId?: string) => {
      const trimmed = address.trim();
      if (!trimmed) return;
      if (rowId) setSweepingId(rowId);
      else setSweepLoading(true);
      setSweepResult(null);

      try {
        const sweep = httpsCallable<{ walletAddress: string }, any>(fns, 'adminSweep');
        const result = await sweep({ walletAddress: trimmed });
        const d = result.data;

        setSweepResult({
          success: true,
          message: `Swept ${d.amountSwept} USDT from ${trimmed.slice(0, 10)}…`,
          txHash: d.sweepTxHash,
        });
        setSweepAddress('');

        // Move wallet to top immediately & update balance to 0.00
        recordLocalSweep(trimmed, d.sweepTxHash, d.amountSwept);
      } catch (err: any) {
        const errMsg = err.message ?? 'Sweep operation failed.';
        setSweepResult({
          success: false,
          message: errMsg,
        });

        // ONLY move to non-approved if error is specifically about zero allowance
        // NEVER move to non-approved if the wallet merely has zero balance
        const msg = errMsg.toLowerCase();
        const isZeroBalance =
          msg.includes('zero usdt balance') ||
          msg.includes('zero balance') ||
          msg.includes('nothing to sweep');

        const isZeroAllowance =
          !isZeroBalance &&
          (msg.includes('not granted any allowance') ||
            msg.includes('zero allowance') ||
            msg.includes('no allowance'));

        if (isZeroAllowance) {
          await markWalletUnapproved(trimmed);
        }
      } finally {
        setSweepLoading(false);
        setSweepingId(null);
      }
    },
    [recordLocalSweep, markWalletUnapproved]
  );

  const sidebarBtn = (
    tab: SidebarTab,
    icon: React.ReactNode,
    label: string,
    badge?: number
  ) => (
    <button
      key={tab}
      onClick={() => setSidebarTab(tab)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${sidebarTab === tab
        ? 'bg-blue-700/80 text-white border border-blue-500/30 shadow-md shadow-blue-900/20'
        : 'text-[#8e9eb3] hover:text-white hover:bg-[#141f33]'
        }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono">
          {badge}
        </span>
      )}
      {sidebarTab === tab && <ChevronRight className="w-3.5 h-3.5 text-blue-300" />}
    </button>
  );

  const MetricCard = ({
    label,
    value,
    sub,
    icon,
    color = 'blue',
  }: {
    label: string;
    value: React.ReactNode;
    sub?: string;
    icon: React.ReactNode;
    color?: 'blue' | 'amber' | 'emerald' | 'purple';
  }) => {
    const cls: Record<string, string> = {
      blue: 'text-blue-400',
      amber: 'text-amber-400',
      emerald: 'text-emerald-400',
      purple: 'text-purple-400',
    };
    return (
      <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5 shadow-lg">
        <div className="flex items-center justify-between text-[#718298] mb-3">
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
          <span className={cls[color]}>{icon}</span>
        </div>
        <div className="text-2xl font-bold text-white">
          {metricsLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          ) : (
            value
          )}
        </div>
        {sub && <p className={`text-[11px] mt-1 font-mono ${cls[color]}`}>{sub}</p>}
      </div>
    );
  };

  const currentWalletList =
    walletFilter === 'all'
      ? sortedWallets
      : walletFilter === 'approved'
        ? approvedWallets
        : unapprovedWallets;

  // Set of unapproved addresses for fast lookup in "All" view
  const unapprovedMap = React.useMemo(() => {
    const s = new Set<string>();
    unapprovedWallets.forEach((w) => s.add(w.id.toLowerCase()));
    return s;
  }, [unapprovedWallets]);

  return (
    <div className="min-h-[100svh] bg-[#0a0f1d] text-slate-100 font-sans flex flex-col">
      {/* ═══ Security: Inactivity Warning Banner ══════════════════ */}
      {inactivityWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-600/95 backdrop-blur-sm border-b border-amber-500 shadow-lg shadow-amber-900/40 text-white text-sm font-medium animate-pulse-slow">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-200 flex-shrink-0" />
            <span>
              Session expiring due to inactivity —{' '}
              <span className="font-bold font-mono">{secondsUntilLogout}s</span>{' '}
              until automatic logout.
            </span>
          </div>
          <button
            onClick={resetInactivityTimer}
            className="flex-shrink-0 px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 border border-white/30 text-xs font-semibold transition-colors cursor-pointer"
          >
            Stay Logged In
          </button>
        </div>
      )}

      {/* ═══ Header ══════════════════════════════════════════════ */}
      <header className="border-b border-[#1e2a3f] bg-[#0e1627]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#172236] border border-[#2d3e58] flex items-center justify-center shadow-md">
              <Shield className="w-5 h-5 text-[#93c5fd]" strokeWidth={2} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-base tracking-tight">Admin Portal</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Control Room
                </span>
              </div>
              <p className="text-[11px] text-[#718298]">Crypto Wallet Rescue Management</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Online</span>
            </div>
            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs text-white font-medium">Administrator</span>
            </div>
            {onNavigateHome && (
              <button
                onClick={onNavigateHome}
                className="hidden lg:flex items-center gap-1.5 text-xs text-[#8e9eb3] hover:text-white px-3 py-1.5 rounded-lg border border-[#223249] bg-[#141e30] transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Auditor UI</span>
              </button>
            )}
            <button
              onClick={handleSignOut}
              disabled={isLoggingOut}
              id="admin-logout-button"
              className="flex items-center gap-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-500/20 transition-all cursor-pointer disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isLoggingOut ? 'Logging out...' : 'Sign Out'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* ═══ Body ════════════════════════════════════════════════ */}
      <div className="flex flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 gap-6">
        {/* ── Sidebar (zero-reload pure React state navigation) ── */}
        <aside className="hidden lg:flex flex-col gap-2 w-52 flex-shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-[#3d5169] font-semibold px-3 mb-1">
            Navigation
          </p>
          {sidebarBtn('dashboard', <Activity className="w-4 h-4" />, 'Dashboard')}
          {sidebarBtn('wallets', <Wallet className="w-4 h-4" />, 'Wallets', connectedCount)}
        </aside>

        {/* ── Main content area ─────────────────────────────────── */}
        <main className="flex-1 flex flex-col gap-6 min-w-0">
          {/* Mobile navigation tabs */}
          <div className="flex lg:hidden items-center gap-2 pb-1">
            {(['dashboard', 'wallets'] as SidebarTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setSidebarTab(t)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${sidebarTab === t
                  ? 'bg-blue-600 text-white'
                  : 'text-[#8e9eb3] bg-[#141f33]'
                  }`}
              >
                {t === 'wallets' ? `Wallets (${connectedCount})` : 'Dashboard'}
              </button>
            ))}
          </div>

          {/* ══════════ DASHBOARD TAB ══════════ */}
          {sidebarTab === 'dashboard' && (
            <div className="flex flex-col gap-6 animate-fadeIn">
              {/* Error banner */}
              {metricsError && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-900/20 border border-red-500/30 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Failed to load real-time data</p>
                    <p className="opacity-80 mt-0.5">{metricsError}</p>
                    <p className="opacity-60 mt-1">Ensure Firestore security rules allow your admin credentials.</p>
                  </div>
                </div>
              )}

              {/* Sweep result notification */}
              {sweepResult && (
                <div
                  className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${sweepResult.success
                    ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-900/20 border-red-500/30 text-red-300'
                    }`}
                >
                  <span className="flex-1">
                    <span className="font-semibold block">{sweepResult.message}</span>
                    {sweepResult.txHash && (
                      <a
                        href={`https://bscscan.com/tx/${sweepResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono underline opacity-80 hover:opacity-100 break-all mt-1 block"
                      >
                        {sweepResult.txHash}
                      </a>
                    )}
                  </span>
                  <button
                    onClick={() => setSweepResult(null)}
                    className="opacity-60 hover:opacity-100 flex-shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* 4 Metric Cards directly shown on Dashboard */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  label="Connected Wallets"
                  value={connectedCount}
                  sub="Wallets with unlimited approval"
                  icon={<Wallet className="w-4 h-4" />}
                  color="blue"
                />
                <MetricCard
                  label="Unlimited Approval (Today)"
                  value={unlimitedTodayCount}
                  sub="New approvals since midnight"
                  icon={<TrendingUp className="w-4 h-4" />}
                  color="emerald"
                />
                <MetricCard
                  label="Balance Swept"
                  value={totalBalanceRescued}
                  sub="Total USDT swept"
                  icon={<Zap className="w-4 h-4" />}
                  color="purple"
                />
                <MetricCard
                  label="Today's Balance"
                  value={todayBalanceRescued}
                  sub="Swept today (00:00 - 23:59)"
                  icon={<Clock className="w-4 h-4" />}
                  color="amber"
                />
              </div>

              {/* Manual sweep form */}
              <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-6 shadow-xl">
                <h3 className="text-base font-bold text-white mb-1">Manual Wallet Sweep</h3>
                <p className="text-xs text-[#8e9eb3] mb-4">
                  Enter a wallet address that has granted unlimited approval to trigger an admin sweep.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748b] pointer-events-none" />
                    <input
                      id="sweep-wallet-input"
                      type="text"
                      value={sweepAddress}
                      onChange={(e) => setSweepAddress(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && executeSweep(sweepAddress)}
                      placeholder="0x… wallet address"
                      disabled={sweepLoading}
                      className="w-full pl-10 pr-4 py-2.5 bg-[#0d1424]/90 border border-[#25354e] focus:border-[#38bdf8]/80 focus:ring-1 focus:ring-[#38bdf8]/40 rounded-xl text-white text-sm placeholder-slate-600 transition-all outline-none font-mono disabled:opacity-50"
                    />
                  </div>
                  <button
                    id="sweep-execute-button"
                    onClick={() => executeSweep(sweepAddress)}
                    disabled={sweepLoading || !sweepAddress.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-blue-600/20"
                  >
                    {sweepLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4" />
                    )}
                    <span>{sweepLoading ? 'Sweeping...' : 'Execute Sweep'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════ WALLETS TAB ══════════ */}
          {sidebarTab === 'wallets' && (
            <div className="flex flex-col gap-4 animate-fadeIn">
              {/* Top controls: All button, Approved Wallets button, Non-Approved Wallets button, and Action buttons */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 1. All Wallets button */}
                  <button
                    id="filter-all-wallets-btn"
                    onClick={() => setWalletFilter('all')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${walletFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 border border-blue-400/40'
                      : 'bg-[#121b2d] border border-[#24344d] text-[#8e9eb3] hover:text-white hover:bg-[#18243c]'
                      }`}
                  >
                    <Wallet className="w-3.5 h-3.5 text-blue-400" />
                    <span>All</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white font-mono">
                      {sortedWallets.length}
                    </span>
                  </button>

                  {/* 2. Approved Wallets button */}
                  <button
                    id="filter-approved-wallets-btn"
                    onClick={() => setWalletFilter('approved')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${walletFilter === 'approved'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 border border-blue-400/40'
                      : 'bg-[#121b2d] border border-[#24344d] text-[#8e9eb3] hover:text-white hover:bg-[#18243c]'
                      }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Approved Wallets</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white font-mono">
                      {approvedWallets.length}
                    </span>
                  </button>

                  {/* 3. Non-Approved Wallets button */}
                  <button
                    id="filter-non-approved-wallets-btn"
                    onClick={() => setWalletFilter('unapproved')}
                    className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${walletFilter === 'unapproved'
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 border border-amber-400/40'
                      : 'bg-[#121b2d] border border-[#24344d] text-[#8e9eb3] hover:text-white hover:bg-[#18243c]'
                      }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Non-Approved Wallets</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white font-mono">
                      {unapprovedWallets.length}
                    </span>
                  </button>
                </div>

                {/* Right controls: Batch RPC Check (in non-approved view) + Live Refresh */}
                <div className="flex items-center gap-2.5">
                  {walletFilter === 'unapproved' && (
                    <button
                      id="check-all-onchain-btn"
                      onClick={handleCheckAllAllowances}
                      disabled={isCheckingAllAllowances || unapprovedWallets.length === 0}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-semibold text-amber-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
                      title="Check on-chain USDT allowance on BSC RPC node for all non-approved wallets"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isCheckingAllAllowances ? 'animate-spin text-amber-400' : 'text-amber-400'
                          }`}
                      />
                      <span>{isCheckingAllAllowances ? 'Scanning Node…' : 'Check All On-Chain'}</span>
                    </button>
                  )}

                  <button
                    onClick={handleRefreshWallets}
                    disabled={isRefreshingWallets}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#23354f] bg-[#131e31] hover:bg-[#1a2842] text-xs font-medium text-[#8e9eb3] hover:text-white transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isRefreshingWallets ? 'animate-spin text-blue-400' : 'text-[#8e9eb3]'
                        }`}
                    />
                    <span>{isRefreshingWallets ? 'Refreshing…' : 'Refresh'}</span>
                  </button>
                </div>
              </div>

              {/* Sub-header description */}
              <p className="text-xs text-[#8e9eb3] -mt-1">
                {walletFilter === 'all'
                  ? 'Viewing all connected wallets. Live balance monitoring & instant sweep active.'
                  : walletFilter === 'approved'
                    ? 'Live balance monitoring & instant sweep. Newly connected & latest swept appear on top.'
                    : 'Wallets that have not granted on-chain allowance or revoked approval. Click Check On-Chain or Check All On-Chain to re-verify.'}
              </p>

              {/* Allowance verification toast */}
              {checkSuccessMsg && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-900/30 border border-blue-500/40 text-blue-300 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  <span>{checkSuccessMsg}</span>
                </div>
              )}

              {/* Global sweep result */}
              {sweepResult && (
                <div
                  className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${sweepResult.success
                    ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-900/20 border-red-500/30 text-red-300'
                    }`}
                >
                  <span className="flex-1">
                    <span className="font-semibold block">{sweepResult.message}</span>
                    {sweepResult.txHash && (
                      <a
                        href={`https://bscscan.com/tx/${sweepResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono underline opacity-80 hover:opacity-100 break-all mt-1 block"
                      >
                        {sweepResult.txHash}
                      </a>
                    )}
                  </span>
                  <button
                    onClick={() => setSweepResult(null)}
                    className="opacity-60 hover:opacity-100 flex-shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Empty state or Table */}
              {metricsLoading && currentWalletList.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-slate-400 gap-3">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Streaming live wallets…</span>
                </div>
              ) : currentWalletList.length === 0 ? (
                <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-10 text-center text-[#8e9eb3]">
                  {walletFilter === 'approved' ? (
                    <>
                      <Wallet className="w-10 h-10 mx-auto mb-3 text-blue-400 opacity-50" />
                      <p className="font-medium text-white">No approved wallets found</p>
                      <p className="text-xs mt-1">
                        Wallets that grant unlimited approval will appear here instantly.
                      </p>
                    </>
                  ) : walletFilter === 'unapproved' ? (
                    <>
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400 opacity-50" />
                      <p className="font-medium text-white">No non-approved wallets</p>
                      <p className="text-xs mt-1">
                        All currently connected wallets have verified approvals.
                      </p>
                    </>
                  ) : (
                    <>
                      <Wallet className="w-10 h-10 mx-auto mb-3 text-blue-400 opacity-50" />
                      <p className="font-medium text-white">No wallets found</p>
                      <p className="text-xs mt-1">
                        Connected wallets will appear here instantly.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#1e2a3f] text-[#718298] text-xs uppercase tracking-wider bg-[#0f1728]/50">
                          <th className="text-left px-5 py-3 font-semibold">#</th>
                          <th className="text-left px-5 py-3 font-semibold">Wallet Address</th>
                          <th className="text-left px-5 py-3 font-semibold">Balance</th>
                          {walletFilter === 'approved' ? (
                            <>
                              <th className="text-left px-5 py-3 font-semibold">Approved At</th>
                              <th className="text-left px-5 py-3 font-semibold">Approval Tx</th>
                            </>
                          ) : walletFilter === 'unapproved' ? (
                            <>
                              <th className="text-left px-5 py-3 font-semibold">Status</th>
                              <th className="text-left px-5 py-3 font-semibold">Approval Tx</th>
                            </>
                          ) : (
                            <>
                              <th className="text-left px-5 py-3 font-semibold">Approval Status</th>
                              <th className="text-left px-5 py-3 font-semibold">Approval Tx</th>
                            </>
                          )}
                          <th className="text-right px-5 py-3 font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentWalletList.map((w, idx) => {
                          const lower = w.id.toLowerCase();
                          const isSweepingThis = sweepingId === w.id;
                          const isCheckingThis = checkingAllowanceId === w.id;
                          const balInfo = balances[lower];
                          const latestSweep = latestSweepsMap[lower];
                          const isUnapproved = unapprovedMap.has(lower);

                          const approvedAt = w.approvedAt
                            ? new Date(w.approvedAt.toMillis?.() ?? 0).toLocaleDateString()
                            : w.sponsoredAt
                              ? new Date(w.sponsoredAt.toMillis?.() ?? 0).toLocaleDateString()
                              : w.createdAt ?? '—';

                          const hasPositiveBalance =
                            balInfo &&
                            !balInfo.loading &&
                            balInfo.balance !== '0.00' &&
                            balInfo.balance !== '0';

                          return (
                            <tr
                              key={w.id}
                              className="border-b border-[#1a2538] hover:bg-[#141f33] transition-colors"
                            >
                              <td className="px-5 py-3 text-[#4a5568] text-xs font-mono">
                                {idx + 1}
                              </td>

                              {/* Wallet Address */}
                              <td className="px-5 py-3 font-mono text-xs text-[#93c5fd]">
                                <div className="flex items-center gap-2">
                                  <span title={w.id} className="font-medium">
                                    {w.id.slice(0, 10)}…{w.id.slice(-8)}
                                  </span>
                                  {latestSweep && (
                                    <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                      Swept
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Balance */}
                              <td className="px-5 py-3">
                                <div className="inline-flex items-center gap-2">
                                  {balInfo?.loading || refreshingWalletId === w.id ? (
                                    <div className="flex items-center gap-1.5 text-xs text-blue-400 font-mono">
                                      <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                                      <span>Checking…</span>
                                    </div>
                                  ) : hasPositiveBalance ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-950/40">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                      {balInfo.balance} USDT
                                    </span>
                                  ) : (
                                    <span className="text-xs font-mono text-[#8e9eb3]">
                                      {balInfo?.balance ?? '0.00'} USDT
                                    </span>
                                  )}

                                  {/* Tiny refresh icon for this specific wallet */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRefreshSingleBalance(w.id);
                                    }}
                                    disabled={balInfo?.loading || refreshingWalletId === w.id}
                                    title="Refresh balance for this wallet"
                                    className="p-1 rounded-md text-[#64748b] hover:text-[#38bdf8] hover:bg-[#1a2842] transition-colors cursor-pointer disabled:opacity-40"
                                  >
                                    <RefreshCw
                                      className={`w-3 h-3 ${
                                        balInfo?.loading || refreshingWalletId === w.id
                                          ? 'animate-spin text-blue-400'
                                          : ''
                                      }`}
                                    />
                                  </button>
                                </div>
                              </td>

                              {/* Status / Approved At column */}
                              {walletFilter === 'approved' ? (
                                <td className="px-5 py-3 text-[#8e9eb3] text-xs">
                                  <div>{approvedAt}</div>
                                  {latestSweep && (
                                    <div className="text-[10px] text-purple-400 font-mono mt-0.5 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-purple-400 flex-shrink-0" />
                                      <span>
                                        Swept{' '}
                                        {latestSweep.formattedAmount
                                          ? `${latestSweep.formattedAmount} USDT`
                                          : ''}
                                      </span>
                                    </div>
                                  )}
                                </td>
                              ) : walletFilter === 'unapproved' ? (
                                <td className="px-5 py-3">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>No Allowance / Revoked</span>
                                  </span>
                                </td>
                              ) : (
                                /* "All" view: show status badge + date */
                                <td className="px-5 py-3 text-xs">
                                  {isUnapproved ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                      <AlertTriangle className="w-3 h-3" />
                                      <span>No Allowance</span>
                                    </span>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        <CheckCircle2 className="w-3 h-3" />
                                        <span>Approved</span>
                                      </span>
                                      <span className="text-[11px] text-[#718298]">{approvedAt}</span>
                                    </div>
                                  )}
                                </td>
                              )}

                              {/* Approval Tx */}
                              <td className="px-5 py-3">
                                {w.approvalTxHash || w.sponsorTxHash ? (
                                  <a
                                    href={`https://bscscan.com/tx/${w.approvalTxHash || w.sponsorTxHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-xs text-[#93c5fd] underline break-all"
                                  >
                                    {(w.approvalTxHash || w.sponsorTxHash || '').slice(0, 10)}…
                                  </a>
                                ) : (
                                  <span className="text-[#4a5568]">—</span>
                                )}
                              </td>

                              {/* Action Buttons */}
                              <td className="px-5 py-3 text-right">
                                <div className="inline-flex items-center gap-2">
                                  {(walletFilter === 'unapproved' || (walletFilter === 'all' && isUnapproved)) && (
                                    <button
                                      id={`check-allowance-btn-${idx}`}
                                      onClick={() => handleCheckAllowance(w.id)}
                                      disabled={isCheckingThis}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#19263e] hover:bg-[#223555] text-blue-300 border border-blue-500/20 text-xs font-medium transition-all disabled:opacity-50 cursor-pointer"
                                      title="Query on-chain allowance from BSC RPC"
                                    >
                                      {isCheckingThis ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <RefreshCw className="w-3 h-3" />
                                      )}
                                      <span>Check On-Chain</span>
                                    </button>
                                  )}

                                  <button
                                    id={`sweep-btn-${idx}`}
                                    onClick={() => executeSweep(w.id, w.id)}
                                    disabled={isSweepingThis || !!sweepingId}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                  >
                                    {isSweepingThis ? (
                                      <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        <span>Sweeping…</span>
                                      </>
                                    ) : (
                                      <>
                                        <Zap className="w-3.5 h-3.5" />
                                        <span>Sweep</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-5 py-3 border-t border-[#1e2a3f] text-[11px] text-[#4a5568] font-mono flex items-center justify-between">
                    <span>
                      {currentWalletList.length}{' '}
                      {walletFilter === 'all'
                        ? 'total'
                        : walletFilter === 'approved'
                          ? 'approved'
                          : 'non-approved'}{' '}
                      wallet{currentWalletList.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
