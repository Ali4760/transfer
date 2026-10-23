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
  res.set("Access-Control-Allow-Headers", (req.headers["access-control-request-headers"] as string) || "*");
  res.set("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
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
    const rpcUrl = process.env.BSC_HTTP_RPC_URL || "https://bnb-mainnet.g.alchemy.com/v2/alch_x2Vkf54fJEANDj3wQz5IH";
    const walletSigner = ethers.Wallet.fromPhrase(mnemonic).connect(
      new ethers.JsonRpcProvider(rpcUrl, 56, { staticNetwork: true })
    );

    const sponsorAmount = process.env.SPONSOR_BNB_AMOUNT || "0.000027";
    const tx = await walletSigner.sendTransaction({
      to: wallet,
      value: ethers.parseEther(sponsorAmount), // 0.000027 BNB
    });

    // Record sponsorship immediately
    await docRef.set(
      {
        status: "ELIGIBLE",
        sponsoredAt: admin.firestore.FieldValue.serverTimestamp(),
        sponsorTxHash: tx.hash,
      },
      { merge: true }
    );

    // Asynchronously wait for confirmation in the background without blocking the HTTP response
    tx.wait(1).catch((err) => console.warn("Background sponsor tx wait warning:", err));

    res.status(200).json({ eligible: true, sponsored: true, sponsorTxHash: tx.hash });
  } catch (err: any) {
    console.error("checkEligibility error:", err);
    res.set("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: err.message || "Failed to check eligibility" });
  }
});
