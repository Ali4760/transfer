// functions/src/api/check-sponsor.ts
import * as functions from 'firebase-functions';
import { db } from '../lib/firestore';

/**
 * HTTP GET endpoint to retrieve sponsorship status for a wallet address.
 * Expects query parameter `address`.
 */
export const checkSponsor = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  const address = req.query.address as string | undefined;
  if (!address) {
    res.status(400).json({ error: 'Missing address query parameter' });
    return;
  }
  const lower = address.toLowerCase();
  const doc = await db.collection('sponsors').doc(lower).get();
  if (!doc.exists) {
    res.status(404).json({ error: 'No sponsorship found' });
    return;
  }
  const data = doc.data();
  res.status(200).json({ status: data?.status ?? 'UNKNOWN', txHash: data?.txHash ?? null });
  return;
});
