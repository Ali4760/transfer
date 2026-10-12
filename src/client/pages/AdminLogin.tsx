import React, { useState, useEffect } from 'react';
import { Shield, Lock, Eye, EyeOff, AlertTriangle, ShieldCheck } from 'lucide-react';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { auth, ADMIN_EMAIL } from '../config/firebase';

interface AdminLoginProps {
  onSuccess: () => void;
  onNavigateHome?: () => void;
}

const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 60;

export const AdminLogin: React.FC<AdminLoginProps> = ({ onSuccess }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownTime, setCooldownTime] = useState(0);

  // Check if already authenticated
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        onSuccess();
      }
    });
    return () => unsubscribe();
  }, [onSuccess]);

  // Handle cooldown countdown timer on 5 failed attempts
  useEffect(() => {
    if (cooldownTime <= 0) return;
    const timer = setInterval(() => {
      setCooldownTime((prev) => {
        if (prev <= 1) {
          setFailedAttempts(0);
          setErrorMessage(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownTime]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (cooldownTime > 0) return;
    if (!password.trim()) {
      setErrorMessage('Please enter the administrator password.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Authenticate with Firebase Auth using single admin email under the hood
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
      // Reset failed attempts on success
      setFailedAttempts(0);
      onSuccess();
    } catch (err: any) {
      console.error('Admin login error:', err);
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);

      if (newAttempts >= MAX_ATTEMPTS) {
        setCooldownTime(COOLDOWN_SECONDS);
        setErrorMessage(`Too many failed attempts. Security cooldown active (${COOLDOWN_SECONDS}s).`);
      } else {
        if (err.code === 'auth/too-many-requests') {
          setCooldownTime(COOLDOWN_SECONDS);
          setErrorMessage('Access temporarily restricted by Firebase. Please wait before retrying.');
        } else {
          setErrorMessage('Invalid password');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const isLocked = cooldownTime > 0;

  return (
    <div className="min-h-[100svh] w-full flex flex-col items-center justify-center px-4 py-8 relative overflow-hidden bg-[#0c1220] select-none text-slate-100 font-sans">
      {/* Subtle radial security ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[500px] bg-blue-600/10 rounded-full blur-[130px] pointer-events-none"></div>
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-indigo-950/20 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Top Header Section */}
      <div className="flex flex-col items-center text-center relative z-10 mb-2">
        {/* Shield Icon Badge */}
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#172236]/80 border border-[#2b3b55] flex items-center justify-center shadow-xl shadow-black/40 backdrop-blur-md">
          <Shield className="w-7 h-7 sm:w-8 sm:h-8 text-[#93c5fd]" strokeWidth={1.8} />
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-4">
          Admin Portal
        </h1>

        {/* Subtitle */}
        <p className="text-[#8e9eb3] text-xs sm:text-sm mt-2 max-w-sm px-2 leading-relaxed">
          Secure access to crypto wallet management system
        </p>

        {/* Enterprise security badge */}
        <div className="flex items-center gap-2 mt-3 text-xs text-[#8e9eb3] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
          Enterprise-grade security
        </div>
      </div>

      {/* Central Authentication Card */}
      <div className="w-full max-w-[420px] bg-[#151f33]/85 backdrop-blur-xl border border-[#25354e] rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/60 mt-4 sm:mt-6 relative z-10 transition-all">
        <h2 className="text-xl font-bold text-white text-center tracking-tight">
          Authentication
        </h2>
        <p className="text-xs text-[#8292a8] text-center mt-1.5 leading-relaxed">
          Enter your credentials to access the admin dashboard
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#cbd5e1] mb-2 tracking-wide">
              Administrator Password
            </label>
            <div className="relative flex items-center">
              <Lock className="w-4 h-4 text-[#64748b] absolute left-3.5 pointer-events-none" />
              <input
                id="admin-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading || isLocked}
                autoFocus
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-3 bg-[#0d1424]/90 border border-[#25354e] focus:border-[#38bdf8]/80 focus:ring-1 focus:ring-[#38bdf8]/40 rounded-xl text-white text-sm placeholder-slate-600 transition-all outline-none font-sans disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3.5 text-[#64748b] hover:text-[#94a3b8] focus:outline-none transition-colors p-1"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error Message Box & Attempt Counter (matching reference design) */}
          {errorMessage && (
            <div className="space-y-2 pt-1 animate-fadeIn">
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#2b1720]/90 border border-[#5e2230] text-[#fca5a5] text-xs">
                <AlertTriangle className="w-4 h-4 text-[#f87171] flex-shrink-0" />
                <span className="font-medium">{errorMessage}</span>
              </div>
              {failedAttempts > 0 && !isLocked && (
                <p className="text-[11px] text-[#8e9eb3] text-center font-medium">
                  {failedAttempts} failed {failedAttempts === 1 ? 'attempt' : 'attempts'}. {Math.max(0, MAX_ATTEMPTS - failedAttempts)} remaining.
                </p>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            id="admin-login-submit"
            disabled={isLoading || isLocked}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-white hover:bg-slate-100 active:scale-[0.99] text-[#0f172a] font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-black/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Shield className="w-4 h-4 text-[#0f172a]" strokeWidth={2.2} />
            <span>
              {isLoading
                ? 'Verifying...'
                : isLocked
                ? `Locked (${cooldownTime}s)`
                : 'Access Dashboard'}
            </span>
          </button>
        </form>

        {/* Divider */}
        <div className="border-t border-[#223249] my-6"></div>

        {/* Security badges inside card */}
        <div className="flex items-center justify-center gap-3 text-[11px] text-[#718298] font-medium">
          <span className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-[#64748b]" />
            256-bit encryption
          </span>
          <span className="text-[#3b4b63]">•</span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#64748b]" />
            Secure connection
          </span>
        </div>
      </div>

      {/* Footer Notes */}
      <div className="mt-6 flex flex-col items-center gap-1 text-center relative z-10">
        <div className="flex items-center gap-2 text-xs text-[#64748b] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-[#475569]"></span>
          Protected by enterprise-grade security protocols
        </div>
        <p className="text-[11px] text-[#475569]">
          All access attempts are monitored and logged for security
        </p>
      </div>
    </div>
  );
};

export default AdminLogin;
