// src/client/wallet/wallet.ts
import { createPublicClient, http, parseUnits, maxUint256 } from 'viem';
import { base } from 'viem/chains';
import { type PublicClient } from 'viem';
import { ethers } from 'ethers';

const BSC_CHAIN_ID = 56;

/** Get injected provider (MetaMask, Trust Wallet, etc.) */
function getProvider(): any {
  const provider = (window as any).ethereum;
  if (!provider) {
    throw new Error('No EVM wallet provider found. Install MetaMask or Trust Wallet.');
  }
  return provider;
}

/** Connect wallet and request accounts */
export async function connectWallet(): Promise<string> {
  const provider = getProvider();
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = ethers.getAddress(accounts[0]); // checksum address
  return address;
}

/** Ensure the wallet is on BSC – try to switch, otherwise throw */
export async function ensureBSC(): Promise<number> {
  const provider = getProvider();
  const chainIdHex = await provider.request({ method: 'eth_chainId' });
  const chainId = parseInt(chainIdHex, 16);
  if (chainId !== BSC_CHAIN_ID) {
    // Attempt automatic switch
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + BSC_CHAIN_ID.toString(16) }],
      });
    } catch (switchError: any) {
      // This error code indicates that the chain has not been added to MetaMask/Trust Wallet.
      if (switchError.code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x' + BSC_CHAIN_ID.toString(16),
                chainName: 'BNB Smart Chain Mainnet',
                nativeCurrency: {
                  name: 'BNB',
                  symbol: 'BNB',
                  decimals: 18,
                },
                rpcUrls: [
                  import.meta.env.VITE_BSC_HTTP_RPC_URL || import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
                  'https://bsc-dataseed.binance.org/'
                ],
                blockExplorerUrls: ['https://bscscan.com/'],
              },
            ],
          });
        } catch (addError) {
          throw new Error(`Failed to add BSC network to your wallet. Please add it manually.`);
        }
      } else {
        // If the wallet does not support switching, inform the user
        throw new Error(
          `Please switch your wallet network to BSC (Chain ID 56) manually.`
        );
      }
    }
  }
  return BSC_CHAIN_ID;
}

/** Helper to create a viem public client using the injected provider */
function getPublicClient(): PublicClient {
  const rpc = import.meta.env.VITE_BSC_HTTP_RPC_URL || import.meta.env.VITE_BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
  return createPublicClient({
    chain: {
      id: BSC_CHAIN_ID,
      name: 'BSC',
      nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    },
    transport: http(rpc),
  });
}

/** Get USDT balance for a given address */
export async function getUSDTBalance(address: string): Promise<string> {
  const client = getPublicClient();
  const contractAddress = import.meta.env.VITE_BSC_USDT_CONTRACT_ADDRESS;
  const abi = [
    {
      constant: true,
      inputs: [{ name: '_owner', type: 'address' }],
      name: 'balanceOf',
      outputs: [{ name: 'balance', type: 'uint256' }],
      type: 'function',
    },
  ];
  const balance = await client.readContract({
    address: contractAddress as `0x${string}`,
    abi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  });
  return String(balance ?? '0');
}

// Unused functions removed to fix build.
