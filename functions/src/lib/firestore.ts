// functions/src/lib/firestore.ts
import * as admin from 'firebase-admin';

// Guard: only call initializeApp once across all hot-reloads and imports.
// Without this guard the Firebase CLI times out when analyzing function code
// because it tries to resolve Application Default Credentials at module-load
// time before any function is actually invoked.
if (!admin.apps.length) {
  admin.initializeApp();
}

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
