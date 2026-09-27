// functions/src/lib/firestore.ts
import * as admin from 'firebase-admin';
import { ServiceAccount } from 'firebase-admin';

// Initialize Firebase Admin SDK using a service‑account JSON stored in an env var.
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT env var is missing');
}
const serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount;
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

export const db = admin.firestore();

/** Retrieve a sponsor document by its id */
export async function getSponsor(id: string) {
  const doc = await db.collection('sponsors').doc(id).get();
  return doc.exists ? doc.data() : null;
}

/** Save a rescue request and return the generated doc id */
export async function saveRescue(payload: Record<string, unknown>) {
  const ref = db.collection('rescues').doc();
  await ref.set({ ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return ref.id;
}
