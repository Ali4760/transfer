// functions/src/index.ts
import { ensureFirebaseAdmin } from './lib/firestore';

// Ensure Firebase Admin is initialized at startup
ensureFirebaseAdmin();

export { verifyRescue } from './api/verifyRescue';
export { adminSweep } from './api/adminSweep';
export { registerWallet } from './api/registerWallet';
