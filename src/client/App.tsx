// src/client/App.tsx
import React, { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import NotFound from './pages/NotFound';
import { AdminDataProvider } from './context/AdminDataContext';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './config/firebase';

type RouteType = 'public' | 'admin-login' | 'not-found';

/**
 * URL Routing Rules:
 * - "/" or "" => "public" (Main auditor website)
 * - "/admin-li" or "/admin-li/" => "admin-login" (Admin portal)
 * - Any other URL (e.g. "/admin", "/login", "/dashboard", etc.) => "not-found" (404 Error)
 */
function getInitialRoute(): RouteType {
  const path = window.location.pathname.toLowerCase();

  // Root path: exact match for homepage
  if (path === '/' || path === '') {
    return 'public';
  }

  // Admin portal: exact match for /admin-li
  if (path === '/admin-li' || path === '/admin-li/') {
    return 'admin-login';
  }

  // Any other URL returns 404
  return 'not-found';
}

function App() {
  const [route, setRoute] = useState<RouteType>(getInitialRoute);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);

  const isAdminRoute = route === 'admin-login';

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

  // ── 404 Not Found Page ─────────────────────────────────────────
  if (route === 'not-found') {
    return <NotFound onNavigateHome={() => navigateTo('public', '/')} />;
  }

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
  // The URL stays locked at /admin-li whether logged in or out.
  if (isAdminRoute) {
    if (isAuthenticated) {
      return (
        <AdminDataProvider>
          <AdminDashboard
            onLogout={() => {
              // Sign out is handled within AdminDashboard; onAuthStateChanged automatically
              // sets isAuthenticated = false and switches view to AdminLogin at /admin-li
            }}
            onNavigateHome={() => navigateTo('public', '/')}
          />
        </AdminDataProvider>
      );
    }
    return (
      <AdminLogin
        onSuccess={() => {
          // onAuthStateChanged automatically sets isAuthenticated = true
          // Keeps URL locked at /admin-li
        }}
        onNavigateHome={() => navigateTo('public', '/')}
      />
    );
  }

  // ── Public website (only on /) ─────────────────────────────────
  return (
    <div className="relative">
      <Dashboard />
    </div>
  );
}

export default App;
