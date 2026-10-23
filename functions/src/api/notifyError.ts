// functions/src/api/notifyError.ts
import * as functions from "firebase-functions/v1";
import { sendTelegramMessage } from "../lib/telegram";

export const notifyError = functions
  .runWith({
    timeoutSeconds: 30,
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

    const { wallet, error: errorMsg } = req.body ?? {};

    if (!wallet || !errorMsg) {
      res.status(400).json({ error: "Missing wallet or error fields" });
      return;
    }

    try {
      console.error(`[Frontend Error Log] Wallet: ${wallet} | Error: ${errorMsg}`);
      await sendTelegramMessage(
        `❌ Rescue Error\nWallet: ${wallet}\nError: ${errorMsg}`
      );
      res.status(200).json({ success: true });
    } catch (e: any) {
      console.error("notifyError failed:", e);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });
