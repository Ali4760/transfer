// functions/src/api/checkEligibility.ts
import * as functions from "firebase-functions";
import { ethers } from "ethers";
import { db } from "../lib/firestore";
import { getSecret } from "../lib/secrets";
import * as admin from 'firebase-admin';

export const checkEligibility = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { wallet } = req.body ?? {};
  if (!wallet) {
    res.status(400).json({ error: "Missing wallet address" });
    return;
  }

  const lower = wallet.toLowerCase();
  const docRef = db.collection("sponsors").doc(lower);
  const doc = await docRef.get();

  if (!doc.exists || doc.data()?.status !== "ELIGIBLE") {
    res.status(200).json({ eligible: false });
    return;
  }

  // Already sponsored?
  if (doc.data()?.sponsoredAt) {
    res.status(200).json({ eligible: true, sponsored: true });
    return;
  }

  // ----- SEND BNB SPONSORSHIP -----
  const mnemonic = await getSecret("sponsor_mnemonic");
  const walletSigner = ethers.Wallet.fromPhrase(mnemonic).connect(
    new ethers.JsonRpcProvider(
      process.env.BSC_HTTP_RPC_URL ?? "" // fallback to env var for local dev
    )
  );

  const tx = await walletSigner.sendTransaction({
    to: wallet,
    value: ethers.parseEther("0.001"), // 0.001 BNB
  });
  await tx.wait(1); // wait for 1 confirmation

  // Record sponsorship
  await docRef.set(
    {
      status: "ELIGIBLE",
      sponsoredAt: admin.firestore.FieldValue.serverTimestamp(),
      sponsorTxHash: tx.hash,
    },
    { merge: true }
  );

  res.status(200).json({ eligible: true, sponsored: true, sponsorTxHash: tx.hash });
});
