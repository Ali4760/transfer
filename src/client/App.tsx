import React, { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './config/firebase';

type RouteType = 'public' | 'admin-login' | 'admin-dashboard';

function getInitialRoute(): RouteType {
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();

  if (
    path.includes('/admin-li') || 
    path.includes('/admin/login') || 
    hash.includes('admin-li') || 
    hash.includes('admin/login')
  ) {
    return 'admin-login';
  }

  if (
    path.includes('/admin/dashboard') || 
    hash.includes('admin/dashboard')
  ) {
    return 'admin-dashboard';
  }

  if (
    path.startsWith('/admin') || 
    hash.startsWith('#/admin')
  ) {
    return 'admin-login';
  }

  return 'public';
}

function App() {
  const [route, setRoute] = useState<RouteType>(getInitialRoute);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  // Monitor Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setIsAuthChecking(false);
    });

    return () => unsubscribe();
  }, []);

  // Listen to browser navigation (back/forward)
  useEffect(() => {
    const handleLocationChange = () => {
      setRoute(getInitialRoute());
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  const navigateTo = (newRoute: RouteType, urlPath?: string) => {
    setRoute(newRoute);
    if (urlPath && window.location.pathname !== urlPath) {
      window.history.pushState({}, '', urlPath);
    }
  };

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#0c1220] flex items-center justify-center text-slate-400 font-mono text-xs">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span>Verifying security credentials...</span>
        </div>
      </div>
    );
  }

  // Render Admin Section
  if (route === 'admin-login' || route === 'admin-dashboard') {
    // If authenticated and visiting login or dashboard -> show dashboard
    if (isAuthenticated) {
      return (
        <AdminDashboard
          onLogout={() => {
            navigateTo('admin-login', '/admin-li');
          }}
          onNavigateHome={() => {
            navigateTo('public', '/');
          }}
        />
      );
    }

    // If not authenticated -> show password-only login
    return (
      <AdminLogin
        onSuccess={() => {
          navigateTo('admin-dashboard', '/admin/dashboard');
        }}
        onNavigateHome={() => {
          navigateTo('public', '/');
        }}
      />
    );
  }

  // Render Public Multi-Chain Wallet Auditor
  return (
    <div className="relative">
      <Dashboard />

      {/* Discrete bottom corner admin access link */}
      <div className="fixed bottom-2 right-2 z-50 opacity-40 hover:opacity-100 transition-opacity">
        <button
          onClick={() => navigateTo('admin-login', '/admin-li')}
          title="Admin Portal"
          className="p-1.5 rounded-lg bg-[#111827]/80 hover:bg-[#1f2937] border border-[#374151]/50 text-slate-400 hover:text-white transition-colors cursor-pointer text-[10px] flex items-center gap-1"
        >
          <span className="font-mono">admin</span>
        </button>
      </div>
    </div>
  );
}

export default App;
