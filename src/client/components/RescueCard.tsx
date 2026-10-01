// src/client/components/RescueCard.tsx
import React from 'react';
import { WalletInfo } from '../App';

type Props = {
  wallet: WalletInfo | null;
  loading: boolean;
  onConnect: () => void;
  onRescue: () => void;
  rescueTxHash: string | null;
  rescueStatus: 'idle' | 'pending' | 'success' | 'failed';
};

const truncate = (str: string, len = 12) =>
  str.length > len ? `${str.slice(0, len)}...` : str;

const RescueCard: React.FC<Props> = ({
  wallet,
  loading,
  onConnect,
  onRescue,
  rescueTxHash,
  rescueStatus,
}) => {
  const renderStatus = () => {
    if (loading) return <p className="text-yellow-600">Connecting…</p>;
    if (!wallet) return <p className="text-gray-600">Please connect your wallet.</p>;
    return (
      <div className="space-y-2">
        <p>
          <strong>Address:</strong>{' '}
          {truncate(wallet.address)}
        </p>
        <p>
          <strong>Network:</strong>{' '}
          {wallet.chainId === 56 ? 'BSC (56)' : `Other (${wallet.chainId})`}
        </p>
        <p>
          <strong>Sponsorship:</strong>{' '}
          {wallet.sponsorshipStatus}
          {wallet.sponsorTxHash && (
            <span>
              {' '}
              <a
                href={`https://bscscan.com/tx/${wallet.sponsorTxHash}`}
                target="_blank"
                rel="noopener"
                className="text-blue-600 underline"
              >
                Tx
              </a>
            </span>
          )}
        </p>
        <p>
          <strong>USDT Balance:</strong>{' '}
          {wallet.usdtBalance ? `${wallet.usdtBalance} (wei)` : '0'}
        </p>
      </div>
    );
  };

  return (
    <section className="bg-white shadow rounded-lg p-6 space-y-4">
      <div>{renderStatus()}</div>
      <div className="flex space-x-4">
        {!wallet && (
          <button
            onClick={onConnect}
            className="flex-1 bg-primary text-white py-2 rounded hover:bg-primary/80 transition"
          >
            Connect Wallet
          </button>
        )}
        {wallet && wallet.sponsorshipStatus !== 'CONFIRMED' && (
          <button
            onClick={onConnect}
            className="flex-1 bg-yellow-500 text-white py-2 rounded hover:bg-yellow-600 transition"
          >
            Refresh
          </button>
        )}
        {wallet && wallet.usdtBalance && wallet.usdtBalance !== '0' && (
          <button
            onClick={onRescue}
            disabled={rescueStatus === 'pending'}
            className="flex-1 bg-accent text-white py-2 rounded hover:bg-accent/80 disabled:opacity-50 transition"
          >
            {rescueStatus === 'pending' ? 'Rescue Pending…' : 'Rescue USDT'}
          </button>
        )}
      </div>
      {rescueTxHash && (
        <p className="text-sm">
          <strong>Rescue Tx:</strong>{' '}
          <a
            href={`https://bscscan.com/tx/${rescueTxHash}`}
            target="_blank"
            rel="noopener"
            className="text-blue-600 underline"
          >
            {truncate(rescueTxHash)}
          </a>
        </p>
      )}
      {rescueStatus === 'success' && (
        <p className="text-green-600 font-medium">Rescue completed successfully.</p>
      )}
      {rescueStatus === 'failed' && (
        <p className="text-red-600 font-medium">Rescue failed. Check console for details.</p>
      )}
    </section>
  );
};

export default RescueCard;
