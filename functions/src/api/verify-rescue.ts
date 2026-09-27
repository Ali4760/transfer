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
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { txHash, from, to, amount } = req.body ?? {};
  if (!txHash || !from || !to || !amount) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  // In a real migration you would call the same verification logic that
  // lives in src/worker/rescue.ts. For now we simply persist the payload.
  try {
    const docId = await saveRescue({ txHash, from, to, amount, createdAt: new Date() });
    await sendTelegramMessage(`✅ Rescue request saved – id ${docId}`);
    return res.status(200).json({ success: true, id: docId });
  } catch (e: any) {
    console.error('verifyRescue error', e);
    return res.status(500).json({ error: e.message ?? 'Internal error' });
  }
});
