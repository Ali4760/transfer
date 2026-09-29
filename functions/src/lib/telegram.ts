// functions/src/lib/telegram.ts
import { getSecret } from './secrets';

export async function sendTelegramMessage(message: string): Promise<void> {
  const token = await getSecret('telegram_token');
  const chatId = process.env.TELEGRAM_CHAT_ID || await getSecret('telegram_chat_id');
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
