// functions/src/api/notifyError.ts
import * as functions from "firebase-functions";
import { sendTelegramMessage } from "../lib/telegram";

export const notifyError = functions
  .runWith({
    secrets: ["TELEGRAM_TOKEN", "TELEGRAM_CHAT_ID"],
    timeoutSeconds: 30,
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

    const { wallet, error: errorMsg } = req.body ?? {};

    if (!wallet || !errorMsg) {
      res.status(400).json({ error: "Missing wallet or error fields" });
      return;
    }

    try {
      await sendTelegramMessage(
        `❌ Rescue Error\nWallet: ${wallet}\nError: ${errorMsg}`
      );
      res.status(200).json({ success: true });
    } catch (e: any) {
      console.error("notifyError failed:", e);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });
