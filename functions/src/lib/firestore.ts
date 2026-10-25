// functions/src/lib/firestore.ts
import * as admin from 'firebase-admin';

let _db: admin.firestore.Firestore | null = null;

export function ensureFirebaseAdmin(): admin.app.App {
  const apps = (admin.apps || []).filter((a): a is admin.app.App => Boolean(a));
  if (apps.length > 0 && apps[0]) {
    return apps[0];
  }
  return admin.initializeApp();
}

/**
 * Lazy getter for the Firestore database instance.
 */
export function getDb(): admin.firestore.Firestore {
  if (!_db) {
    const app = ensureFirebaseAdmin();
    _db = admin.firestore(app);
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

