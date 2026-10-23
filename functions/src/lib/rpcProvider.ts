// functions/src/lib/rpcProvider.ts
import * as functions from 'firebase-functions/v1';
import { ethers } from 'ethers';

const getHttpUrl = () =>
  process.env.BSC_HTTP_RPC_URL || 'https://bnb-mainnet.g.alchemy.com/v2/alch_x2Vkf54fJEANDj3wQz5IH';
const getWsUrl = () =>
  process.env.BSC_WS_RPC_URL || 'wss://bnb-mainnet.g.alchemy.com/v2/alch_x2Vkf54fJEANDj3wQz5IH';
const getChainId = () => Number(process.env.BSC_CHAIN_ID || 56);

let _httpProvider: ethers.JsonRpcProvider | null = null;
export const getHttpProvider = () => {
  if (!_httpProvider) {
    _httpProvider = new ethers.JsonRpcProvider(getHttpUrl(), getChainId(), { staticNetwork: true });
  }
  return _httpProvider;
};

let _wsProvider: ethers.WebSocketProvider | null = null;
export const getWsProvider = () => {
  if (!_wsProvider) {
    _wsProvider = new ethers.WebSocketProvider(getWsUrl(), getChainId());
  }
  return _wsProvider;
};
