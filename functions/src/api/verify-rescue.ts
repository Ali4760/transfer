// functions/src/api/verify-rescue.ts
import * as functions from 'firebase-functions';
import { saveRescue } from '../lib/firestore';
import { sendTelegramMessage } from '../lib/telegram';

/**
 * HTTP endpoint that receives a rescue verification request.
 * Expected payload (JSON): { txHash, from, to, amount }
 */
export const verifyRescue = functions.https.onRequest(async (req, res) => {
  // CORS – allow any origin (adjust for prod later)
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  const { txHash, from, to, amount } = req.body ?? {};
  if (!txHash || !from || !to || !amount) {
    res.status(400).json({ error: 'Missing fields' });
    return;
  }
  try {
    const docId = await saveRescue({ txHash, from, to, amount, createdAt: new Date() });
    await sendTelegramMessage(`✅ Rescue request saved – id ${docId}`);
    res.status(200).json({ success: true, id: docId });
    return;
  } catch (e: any) {
    console.error('verifyRescue error', e);
    res.status(500).json({ error: e.message ?? 'Internal error' });
    return;
  }
});
