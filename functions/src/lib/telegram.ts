// functions/src/lib/telegram.ts
import { getSecret } from './secrets';

const DEFAULT_CHAT_ID = "-1004433172233";

export async function sendTelegramMessage(message: string): Promise<void> {
  let token = "";
  let chatId = "";
  try {
    token = (process.env.TELEGRAM_TOKEN || await getSecret('TELEGRAM_TOKEN') || "").trim();
    chatId = (process.env.TELEGRAM_CHAT_ID || await getSecret('TELEGRAM_CHAT_ID') || DEFAULT_CHAT_ID).trim();
    console.log(`Loaded Telegram Token starts with "${token.substring(0, 4)}..." (Length: ${token.length})`);
    console.log(`Loaded Telegram Chat ID starts with "${chatId.substring(0, 2)}..." (Length: ${chatId.length})`);
  } catch (e) {
    console.warn("Could not fetch telegram secrets from Secret Manager.");
  }
  if (!chatId) {
    chatId = DEFAULT_CHAT_ID;
  }
  if (!token || !chatId) {
    console.warn('Telegram credentials not set – skipping notification');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
  };
  try {
    let resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.warn('Telegram send failed with markdown, retrying as plain text:', resp.status, txt);
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
      if (!resp.ok) {
        const fallbackTxt = await resp.text();
        console.error('Telegram fallback send failed:', resp.status, fallbackTxt);
      }
    }
  } catch (e) {
    console.error('Telegram send exception', e);
  }
}
