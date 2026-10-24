// src/client/config/walletLink.ts
/// <reference types="vite/client" />

export interface WalletLinkState {
  address: string;
  pageStart: number;
  verified: boolean;
  isInjected: () => boolean;
  walletBrowserHint: () => boolean;
  inWalletBrowser: () => boolean;
  needsWalletOpen: () => boolean;
  waitedMs: () => number;
}

declare global {
  interface Window {
    __walletLink?: WalletLinkState;
  }
}

export function getWalletLink(): WalletLinkState | null {
  if (typeof window === 'undefined') return null;
  return window.__walletLink || null;
}

export const TRUST_WALLET_COIN_ID = Number(import.meta.env?.VITE_BSC_CHAIN_ID || 56);
export const DEEP_LINK_BASE = import.meta.env?.VITE_API_BASE || '';
