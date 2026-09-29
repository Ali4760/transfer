// functions/src/lib/firestore.ts
import * as admin from 'firebase-admin';


// Initialize Firebase Admin SDK with default credentials
admin.initializeApp();

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
