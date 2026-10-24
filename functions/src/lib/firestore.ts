// functions/src/lib/firestore.ts
import * as admin from 'firebase-admin';

let _db: admin.firestore.Firestore | null = null;

/**
 * Lazy getter for the Firestore database instance.
 * Ensures admin.initializeApp() and admin.firestore() are never called at
 * module import time, preventing Firebase CLI analysis timeouts (>10s) in CI.
 */
export function getDb(): admin.firestore.Firestore {
  if (!_db) {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    _db = admin.firestore();
  }
  return _db;
}

/**
 * Proxy wrapper so existing code using `db.collection(...)` or `db.doc(...)`
 * continues to work transparently without eager initialization.
 */
export const db = new Proxy({} as admin.firestore.Firestore, {
  get(_target, prop) {
    const firestoreInstance = getDb() as any;
    const value = firestoreInstance[prop];
    if (typeof value === 'function') {
      return value.bind(firestoreInstance);
    }
    return value;
  },
});

/** Retrieve a sponsor document by its id */
export async function getSponsor(id: string) {
  const doc = await getDb().collection('sponsors').doc(id).get();
  return doc.exists ? doc.data() : null;
}

/** Save a rescue request and return the generated doc id */
export async function saveRescue(payload: Record<string, unknown>) {
  const ref = getDb().collection('rescues').doc();
  await ref.set({ ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  return ref.id;
}

