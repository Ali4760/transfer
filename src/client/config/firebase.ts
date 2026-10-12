// src/client/config/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

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

// Default Admin Email for single-password authentication
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "admin@rescue.internal";
