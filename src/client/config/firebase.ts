// src/client/config/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, browserSessionPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('[Firebase] Missing required environment variables (VITE_FIREBASE_API_KEY or VITE_FIREBASE_PROJECT_ID). Check your .env file.');
}

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
