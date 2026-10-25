// functions/src/index.ts
import { ensureFirebaseAdmin } from './lib/firestore';

// Ensure Firebase Admin is initialized at startup
ensureFirebaseAdmin();

export { verifyRescue } from './api/verifyRescue';
export { notifyError } from './api/notifyError';
export { adminSweep } from './api/adminSweep';
export { registerWallet } from './api/registerWallet';
