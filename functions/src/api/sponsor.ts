// functions/src/api/sponsor.ts
import * as functions from 'firebase-functions';
import { db } from '../lib/firestore';
import { sendTelegramMessage } from '../lib/telegram';

/**
 * HTTP endpoint to sponsor a wallet address.
 * Mirrors the logic from src/worker/sponsor.ts but stores state in Firestore.
 */
export const sponsor = functions.runWith({ secrets: ["TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"] }).https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  const { address } = req.body ?? {};
  if (!address) {
    res.status(400).json({ error: 'Missing address' });
    return;
  }
  const lower = address.toLowerCase();
  const sponsorsRef = db.collection('sponsors').doc(lower);
  const doc = await sponsorsRef.get();
  if (doc.exists) {
    const data = doc.data();
    res.status(200).json({ status: data?.status ?? 'UNKNOWN', txHash: data?.txHash ?? null });
    return;
  }
  const pending = { status: 'PENDING', createdAt: new Date().toISOString() };
  await sponsorsRef.set(pending);
  await sendTelegramMessage(`🟡 Sponsorship pending for ${address}`);
  res.status(200).json({ status: 'PENDING', txHash: null });
});
