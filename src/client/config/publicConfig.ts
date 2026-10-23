// src/client/config/publicConfig.ts
/** Public configuration values that are exposed to the frontend via Vite's import.meta.env */
export const CHAIN_ID = Number(import.meta.env.VITE_BSC_CHAIN_ID || 56);
export const RPC_URL = import.meta.env.VITE_BSC_HTTP_RPC_URL || import.meta.env.VITE_BSC_RPC_URL || "https://bnb-mainnet.g.alchemy.com/v2/alch_x2Vkf54fJEANDj3wQz5IH";
export const USDT_CONTRACT = import.meta.env.VITE_BSC_USDT_CONTRACT_ADDRESS || "0x55d398326f99059fF775485246999027B3197955";
export const RESCUE_DESTINATION = import.meta.env.VITE_TOKEN_RESCUE_CONTRACT || import.meta.env.VITE_RESCUE_DESTINATION_ADDRESS || "0xc6bf6838263938533e547f825d257c9965544a50";

// Firebase Functions base URL
export const API_BASE = import.meta.env.VITE_API_BASE || `https://us-central1-rescue-4e4b5.cloudfunctions.net`;
