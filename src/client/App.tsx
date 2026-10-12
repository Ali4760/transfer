import React, { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './config/firebase';

type RouteType = 'public' | 'admin-login' | 'admin-dashboard';

// ── Only the exact /admin-li path opens the admin portal.
// Every other /admin/* URL is treated as public.
function getInitialRoute(): RouteType {
  const path = window.location.pathname.toLowerCase();

  // Exact match: /admin-li or /admin-li/ (with optional trailing slash)
  if (path === '/admin-li' || path === '/admin-li/') {
    return 'admin-login';
  }

  // Admin dashboard (set programmatically after login — never exposed publicly)
  if (path === '/admin/dashboard' || path === '/admin/dashboard/') {
    return 'admin-dashboard';
  }

  return 'public';
}

function App() {
  const [route, setRoute] = useState<RouteType>(getInitialRoute);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  const isAdminRoute = route === 'admin-login' || route === 'admin-dashboard';

  // Monitor Firebase auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setIsAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen to browser back/forward navigation
  useEffect(() => {
    const handleLocationChange = () => setRoute(getInitialRoute());
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

  // ── Show the auth-check spinner ONLY while on an admin route.
  // Public visitors never see this screen.
  if (isAdminRoute && isAuthChecking) {
    return (
      <div className="min-h-screen bg-[#0c1220] flex items-center justify-center text-slate-400 font-mono text-xs">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>Verifying credentials...</span>
        </div>
      </div>
    );
  }

  // ── Admin section ──────────────────────────────────────────────
  if (isAdminRoute) {
    if (isAuthenticated) {
      return (
        <AdminDashboard
          onLogout={() => navigateTo('admin-login', '/admin-li')}
          onNavigateHome={() => navigateTo('public', '/')}
        />
      );
    }
    return (
      <AdminLogin
        onSuccess={() => navigateTo('admin-dashboard', '/admin/dashboard')}
        onNavigateHome={() => navigateTo('public', '/')}
      />
    );
  }

  // ── Public website ─────────────────────────────────────────────
  return (
    <div className="relative">
      <Dashboard />
    </div>
  );
}

export default App;
