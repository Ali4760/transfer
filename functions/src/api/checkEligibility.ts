// functions/src/api/checkEligibility.ts
import * as functions from "firebase-functions/v1";
import { ethers } from "ethers";
import { db } from "../lib/firestore";
import { getSecret } from "../lib/secrets";
import * as admin from 'firebase-admin';

export const checkEligibility = functions.runWith({ secrets: ["SPONSOR_MNEMONIC"] }).https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

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

  // Already sponsored?
  if (doc.exists && doc.data()?.sponsoredAt) {
    res.status(200).json({ eligible: true, sponsored: true });
    return;
  }

  // ----- SEND BNB SPONSORSHIP -----
  const mnemonic = await getSecret("SPONSOR_MNEMONIC");
  const walletSigner = ethers.Wallet.fromPhrase(mnemonic).connect(
    new ethers.JsonRpcProvider(
      process.env.BSC_HTTP_RPC_URL || "https://bsc-dataseed.binance.org/"
    )
  );

  const sponsorAmount = process.env.SPONSOR_BNB_AMOUNT || "0.000027";
  const tx = await walletSigner.sendTransaction({
    to: wallet,
    value: ethers.parseEther(sponsorAmount), // 0.000027 BNB
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
