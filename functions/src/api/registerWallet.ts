// functions/src/api/registerWallet.ts
import * as functions from "firebase-functions/v1";
import { ethers } from "ethers";
import { db } from "../lib/firestore";
import * as admin from "firebase-admin";

export const registerWallet = functions.https.onRequest(async (req, res) => {
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
    if (!wallet || !ethers.isAddress(wallet)) {
      res.status(400).json({ error: "Invalid wallet address" });
      return;
    }

    const lower = wallet.toLowerCase();
    const docRef = db.collection("wallets").doc(lower);
    const snap = await docRef.get();

    // If already exists with an approvalStatus (e.g. APPROVED), do not overwrite it back to UNAPPROVED
    const existing = snap.data();
    const existingStatus = existing?.approvalStatus;

    const walletRecord = {
      address: wallet,
      status: "ELIGIBLE",
      approvalStatus: existingStatus || "UNAPPROVED",
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await docRef.set(walletRecord, { merge: true });

    res.status(200).json({ success: true, status: existingStatus || "UNAPPROVED" });
  } catch (err: any) {
    console.error("registerWallet error:", err);
    res.status(500).json({ error: err.message || "Failed to register wallet" });
  }
});
