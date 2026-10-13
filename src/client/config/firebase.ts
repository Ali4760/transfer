// src/client/config/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, browserSessionPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDm8hjaEHVus9WlBemFGYrp_UcVZ4MdhEA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rescue-4e4b5.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rescue-4e4b5",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rescue-4e4b5.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1069735572173",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1069735572173:web:47c14d69015807e6d62f84",
};

// Initialize Firebase
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const fns = getFunctions(app);

// ── Security: Use SESSION persistence (not LOCAL) ─────────────────────────
// SESSION persistence means the auth token is stored only in sessionStorage,
// NOT in localStorage. It is automatically cleared when the browser tab or
// window is closed (or the laptop is powered off), so the admin can never
// return to an already-authenticated session without re-entering credentials.
setPersistence(auth, browserSessionPersistence).catch((err) =>
  console.error('[Auth] Failed to set session persistence:', err)
);

// Session timeout constants (exported for use in AdminDashboard)
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;   // 15 minutes inactivity → auto-logout
export const SESSION_WARN_MS   =  2 * 60 * 1000;   // Show warning 2 minutes before logout

// Default Admin Email for single-password authentication
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "admin@rescue.internal";
