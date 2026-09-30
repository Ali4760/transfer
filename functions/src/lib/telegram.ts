// functions/src/lib/telegram.ts
import { getSecret } from './secrets';

export async function sendTelegramMessage(message: string): Promise<void> {
  let token = "";
  let chatId = "";
  try {
    token = (process.env.TELEGRAM_TOKEN || await getSecret('TELEGRAM_TOKEN') || "").trim();
    chatId = (process.env.TELEGRAM_CHAT_ID || await getSecret('TELEGRAM_CHAT_ID') || "").trim();
  } catch (e) {
    console.warn("Could not fetch telegram secrets from Secret Manager.");
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
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Telegram send failed', resp.status, txt);
    }
  } catch (e) {
    console.error('Telegram send exception', e);
  }
}
