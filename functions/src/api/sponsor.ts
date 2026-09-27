// functions/src/api/sponsor.ts
import * as functions from 'firebase-functions';
import { db } from '../lib/firestore';
import { sendTelegramMessage } from '../lib/telegram';

/**
 * HTTP endpoint to sponsor a wallet address.
 * Mirrors the logic from src/worker/sponsor.ts but stores state in Firestore.
 */
export const sponsor = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { address } = req.body ?? {};
  if (!address) {
    return res.status(400).json({ error: 'Missing address' });
  }
  const lower = address.toLowerCase();
  const sponsorsRef = db.collection('sponsors').doc(lower);
  const doc = await sponsorsRef.get();
  if (doc.exists) {
    const data = doc.data();
    return res.status(200).json({ status: data?.status ?? 'UNKNOWN', txHash: data?.txHash ?? null });
  }
  const pending = { status: 'PENDING', createdAt: new Date().toISOString() };
  await sponsorsRef.set(pending);
  await sendTelegramMessage(`🟡 Sponsorship pending for ${address}`);
  return res.status(200).json({ status: 'PENDING', txHash: null });
});
