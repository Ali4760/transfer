import React, { useState } from 'react';
import { 
  Shield, 
  LogOut, 
  Activity, 
  Database, 
  Layers, 
  Settings, 
  ExternalLink, 
  CheckCircle2, 
  TrendingUp, 
  Clock, 
  Zap, 
  Server
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth, ADMIN_EMAIL } from '../config/firebase';

interface AdminDashboardProps {
  onLogout: () => void;
  onNavigateHome?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout, onNavigateHome }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'rescues' | 'sponsors' | 'settings'>('overview');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleSignOut = async () => {
    setIsLoggingOut(true);
    try {
      await signOut(auth);
      onLogout();
    } catch (err) {
      console.error('Error signing out:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-[100svh] bg-[#0a0f1d] text-slate-100 font-sans flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-[#1e2a3f] bg-[#0e1627]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
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

          {/* Right Header Actions */}
          <div className="flex items-center gap-3">
            {/* Status Pill */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Firebase Online</span>
            </div>

            {/* Admin badge */}
            <div className="hidden md:flex flex-col text-right">
              <span className="text-xs text-white font-medium">Administrator</span>
              <span className="text-[10px] text-[#718298] font-mono">{ADMIN_EMAIL}</span>
            </div>

            {/* Public App Switcher */}
            {onNavigateHome && (
              <button
                onClick={onNavigateHome}
                className="hidden lg:flex items-center gap-1.5 text-xs text-[#8e9eb3] hover:text-white px-3 py-1.5 rounded-lg border border-[#223249] bg-[#141e30] transition-colors"
                title="View Client Auditor"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Auditor UI</span>
              </button>
            )}

            {/* Logout Button */}
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

      {/* Main Body */}
      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
        
        {/* Welcome Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#131c2e] via-[#16233a] to-[#101828] border border-[#263750] p-6 shadow-xl">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[11px] font-mono mb-2">
                <CheckCircle2 className="w-3 h-3" />
                <span>Authenticated Admin Session Active</span>
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                System Overview & Management
              </h2>
              <p className="text-sm text-[#8e9eb3] mt-1">
                Monitor rescue requests, sponsored transactions, and smart contract audit telemetry in real-time.
              </p>
            </div>
            
            <div className="flex items-center gap-2 self-start md:self-auto">
              <span className="text-xs text-[#718298] font-mono">Project: rescue-4e4b5</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-[#1e2a3f] pb-3">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-[#8e9eb3] hover:text-white hover:bg-[#141f33]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => setActiveTab('rescues')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'rescues'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-[#8e9eb3] hover:text-white hover:bg-[#141f33]'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Rescue Requests</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#1b283d] text-blue-300">Soon</span>
          </button>

          <button
            onClick={() => setActiveTab('sponsors')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'sponsors'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-[#8e9eb3] hover:text-white hover:bg-[#141f33]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Sponsors & Gas</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#1b283d] text-blue-300">Soon</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-[#8e9eb3] hover:text-white hover:bg-[#141f33]'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configuration</span>
          </button>
        </div>

        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <div className="flex flex-col gap-6 animate-fadeIn">
            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between text-[#718298] mb-3">
                  <span className="text-xs font-medium uppercase tracking-wider">Cloud Functions</span>
                  <Server className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold text-white">5 Active</div>
                <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  us-central1 operational
                </p>
              </div>

              <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between text-[#718298] mb-3">
                  <span className="text-xs font-medium uppercase tracking-wider">Database Mode</span>
                  <Database className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold text-white">Firestore</div>
                <p className="text-[11px] text-[#8e9eb3] mt-1 font-mono">
                  Collections: rescues, sponsors
                </p>
              </div>

              <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between text-[#718298] mb-3">
                  <span className="text-xs font-medium uppercase tracking-wider">Audit Protocols</span>
                  <Shield className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-white">BNB + TRON</div>
                <p className="text-[11px] text-[#8e9eb3] mt-1 font-mono">
                  Chain ID 56 (BSC) Active
                </p>
              </div>

              <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between text-[#718298] mb-3">
                  <span className="text-xs font-medium uppercase tracking-wider">Auth Method</span>
                  <Activity className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold text-white">Secure Admin</div>
                <p className="text-[11px] text-purple-300 mt-1 font-mono">
                  Single-password protection
                </p>
              </div>
            </div>

            {/* Modular Workspace Notice */}
            <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Admin Portal Initialization Complete
                  </h3>
                  <p className="text-sm text-[#8e9eb3] mt-1 leading-relaxed max-w-3xl">
                    The password-only authentication flow is fully active and wired to Firebase. 
                    As requested, this base dashboard is established and ready. We can now add all the specific 
                    management pages, data tables, approval controls, and functions you require!
                  </p>

                  <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-[#0b101c] border border-[#1e2c40]">
                      <span className="text-xs font-semibold text-white block">1. Live Rescues Viewer</span>
                      <p className="text-[11px] text-[#718298] mt-1">
                        View submitted rescue requests, wallet addresses, and execution status.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#0b101c] border border-[#1e2c40]">
                      <span className="text-xs font-semibold text-white block">2. Gas Sponsor Manager</span>
                      <p className="text-[11px] text-[#718298] mt-1">
                        Review sponsorship funds, approve gas dispensations, and monitor balances.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#0b101c] border border-[#1e2c40]">
                      <span className="text-xs font-semibold text-white block">3. Contract Configs</span>
                      <p className="text-[11px] text-[#718298] mt-1">
                        Update spender contract addresses, RPC endpoints, and system alerts.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Rescues Placeholder */}
        {activeTab === 'rescues' && (
          <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-8 text-center animate-fadeIn">
            <Zap className="w-10 h-10 text-blue-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-white">Rescue Transactions Module</h3>
            <p className="text-sm text-[#8e9eb3] mt-1 max-w-md mx-auto">
              This section will display incoming rescue tasks, target tokens, wallet balances, and recovery outcomes.
            </p>
            <p className="text-xs text-blue-400/80 mt-3 font-mono">Ready for discussion and implementation.</p>
          </div>
        )}

        {/* Tab 3: Sponsors Placeholder */}
        {activeTab === 'sponsors' && (
          <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-8 text-center animate-fadeIn">
            <Layers className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-white">Gas Sponsorship Controller</h3>
            <p className="text-sm text-[#8e9eb3] mt-1 max-w-md mx-auto">
              Manage sponsors, fund disbursements, gas safety limits, and on-chain rescue transactions.
            </p>
            <p className="text-xs text-amber-400/80 mt-3 font-mono">Ready for discussion and implementation.</p>
          </div>
        )}

        {/* Tab 4: Configuration */}
        {activeTab === 'settings' && (
          <div className="bg-[#121b2d] border border-[#24344d] rounded-2xl p-6 sm:p-8 animate-fadeIn">
            <h3 className="text-lg font-bold text-white mb-4">Environment & Firebase Settings</h3>
            
            <div className="space-y-4 max-w-2xl font-mono text-xs">
              <div className="p-3 bg-[#0b101c] rounded-xl border border-[#1e2c40] flex justify-between items-center">
                <span className="text-[#8e9eb3]">Admin Email Identifier:</span>
                <span className="text-white font-semibold">{ADMIN_EMAIL}</span>
              </div>
              <div className="p-3 bg-[#0b101c] rounded-xl border border-[#1e2c40] flex justify-between items-center">
                <span className="text-[#8e9eb3]">Firebase Project:</span>
                <span className="text-white">rescue-4e4b5</span>
              </div>
              <div className="p-3 bg-[#0b101c] rounded-xl border border-[#1e2c40] flex justify-between items-center">
                <span className="text-[#8e9eb3]">Auth Domain:</span>
                <span className="text-white">rescue-4e4b5.firebaseapp.com</span>
              </div>
              <div className="p-3 bg-[#0b101c] rounded-xl border border-[#1e2c40] flex justify-between items-center">
                <span className="text-[#8e9eb3]">Storage Bucket:</span>
                <span className="text-white">rescue-4e4b5.firebasestorage.app</span>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminDashboard;
