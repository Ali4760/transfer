// QA harness for the wallet-detection flow (run with playwright-core directly).
//   node scripts/qa-wallet-flow.mjs [url]
// Wallet stubs live in a separate file on disk: page functions are serialised by
// source, so they cannot capture anything from this module's scope.
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4173/';
const CHROME = process.env.QA_CHROME ||
  join(homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const ADDR = '0xF8e3FEa5B3239fAfAcdb629c410917A21a2472a2';
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-shots');
mkdirSync(outDir, { recursive: true });


async function scenario(name, { mode, addressParam }) {
  const out = { name };
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleMsgs = [];
  page.on('console', (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleMsgs.push(`pageerror: ${e.message}`));

  // Keep the automatic deep link from navigating the test page away
  await ctx.route('**/link.trustwallet.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>deep link</p>' })
  );
  if (mode) {
    await page.addInitScript({ path: join(dirname(fileURLToPath(import.meta.url)), 'wallet-stub.js') });
    await page.addInitScript(({ mode, addr }) => { window.__installWallet(mode, addr); }, { mode, addr: ADDR });
  }

  const url = addressParam ? `${URL}?address=${ADDR}` : URL;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // scenario B waits for the account, so give the page time to settle
  await page.waitForTimeout(mode ? 7000 : 3000);

  out.state = await page.evaluate(() => ({
    calls: window.__calls || [],
    banner: /Open this page in Trust Wallet|Opening Trust Wallet/.exec(document.body.innerText)?.[0] || null,
    connectedRow: /Connected wallet\s+(0x[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{5})/.exec(document.body.innerText)?.[1] || null,
  }));
  await page.screenshot({ path: `${outDir}/qa-${name[0].toLowerCase()}.png` });

  await page.locator('input[type=number]').fill('1').catch(() => { });
  await page.evaluate(() => { window.__calls = []; });
  await page.getByRole('button', { name: /^Next$/ }).click({ timeout: 5000 }).catch(() => { });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/qa-${name[0].toLowerCase()}-next.png` });

  out.callsOnNext = await page.evaluate(() => window.__calls || []);
  out.dialog = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog], [role=alertdialog]');
    return d ? d.innerText.replace(/\n+/g, ' / ').slice(0, 180) : null;
  });
  out.buttonText = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /Next|wrong|try again/.test(x.innerText));
    return b ? b.innerText : null;
  });
  out.errors = consoleMsgs.filter((m) => /^error|pageerror/.test(m)).slice(0, 3);
  out.finalUrl = page.url();
  await browser.close();
  return out;
}

const results = [];
results.push(await scenario('A: linked wallet (eth_accounts answers)', { mode: 'linked' }));
results.push(await scenario('B: wallet injected, account appears a few seconds later', { mode: 'delayed' }));
results.push(await scenario('C: nothing linked + connect screen cancelled', { mode: 'cancel' }));
results.push(await scenario('D: plain browser, ?address= in URL', { addressParam: true }));
results.push(await scenario('E: plain browser, no address', {}));

console.log(JSON.stringify(results, null, 2));
