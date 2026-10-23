# Comprehensive Security Audit Report & Remediation Plan

**Project:** `rescue-4e4b5` (BSC USDT Rescue & Wallet Auditor)  
**Date:** 2026-10-20  
**Status:** 🛡️ Audit Complete — Ready for Remediation  
**Scope:** Full-Stack Architecture (Smart Contract Integrations, Cloud Functions Backend, Authentication & Firestore Security Rules, Client Application, and Git History)

---

## Table of Contents

1. [Executive Summary & Threat Landscape](#executive-summary)
2. [Vulnerability Scoring Matrix](#scoring-matrix)
3. [🔴 Critical Vulnerabilities](#critical-vulnerabilities)
   - [VULN-01: Unauthenticated Gas Sponsorship Drain](#vuln-01)
   - [VULN-02: Telegram Alert Denial of Service & Spam Flooding](#vuln-02)
4. [🟠 High-Severity Architectural Risks](#high-severity)
   - [VULN-03: Client-Side Only Brute Force Cooldown on Admin Portal](#vuln-03)
   - [VULN-04: Unauthenticated Sweep Execution Vector](#vuln-04)
5. [🟡 Medium-Severity Vulnerabilities](#medium-severity)
   - [VULN-05: Missing Collection-Level & Field-Level Firestore Validation](#vuln-05)
   - [VULN-06: Historic Revoked Secret Retention in Git History](#vuln-06)
6. [🟢 Low-Severity & Defense-in-Depth Findings](#low-severity)
7. [Step-by-Step Remediation Plan & Code Fixes](#remediation-plan)
8. [Verification & Testing Checklist](#verification)

---

<a name="executive-summary"></a>
## 1. Executive Summary & Threat Landscape

This security assessment conducted an in-depth audit across the consolidated single-folder architecture of the `rescue-4e4b5` workspace. 

### Key Strengths Already Present
- **Session Persistence**: Authentication utilizes `browserSessionPersistence`, ensuring administrative tokens are never persisted across browser tab closures or device reboots.
- **Server-Side Secret Management**: Sensitive private keys and Telegram tokens are isolated within Google Cloud Secret Manager rather than baked into source code.
- **Authorized Sweeps**: The core `adminSweep` callable function validates server-side authentication tokens (`request.auth.token.email`) prior to executing transactions.

### Key Threats Requiring Immediate Remediation
1. **Financial Asset Depletion**: The `checkEligibility` endpoint transfers real BNB on BSC mainnet without verifying whether the recipient address holds USDT or has granted smart contract allowance.
2. **Notification Pipeline Disruption**: The public `notifyError` and `sponsor` endpoints allow unrestricted input that can trigger Telegram API rate limits (`HTTP 429`), silencing legitimate rescue alerts.
3. **Audit Trail Integrity**: Firestore security rules permit unrestricted deletions across all collections by authenticated accounts, lacking schema constraints and immutable log protections.

---

<a name="scoring-matrix"></a>
## 2. Vulnerability Scoring Matrix

| ID | Title | Severity | Impact | Exploitability | Remediation Effort |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **VULN-01** | Unauthenticated Gas Sponsorship Drain | 🔴 **CRITICAL** | Financial Loss (Sponsor Wallet BNB) | High (Trivial curl loop) | Low (15 lines of code) |
| **VULN-02** | Telegram Alert Denial of Service & Flooding | 🟠 **HIGH** | Operational Blindness | High (Public endpoint) | Low (Sanitization + Rate Limit) |
| **VULN-03** | Client-Only Admin Login Attempt Cooldown | 🟠 **HIGH** | Account Compromise | Medium (Direct API scripting) | Medium (App Check / MFA) |
| **VULN-04** | Unauthenticated Sweep Trigger in `verifyRescue` | 🟠 **HIGH** | Front-running / Gas Griefing | Medium (Mempool monitoring) | Medium (Session validation) |
| **VULN-05** | Missing Firestore Schema & Immutable Rules | 🟡 **MEDIUM** | Audit Trail Deletion | Low (Requires Admin Token) | Low (Rules adjustment) |
| **VULN-06** | Historical Secret in Git Commit `c8ecb17` | 🟡 **MEDIUM** | Credential Exposure | Low (Token already revoked) | Low (git-filter-repo) |
| **LOW-01** | Wildcard CORS Across All Endpoints | 🟢 **LOW** | Cross-Origin Data Leakage | Low | Trivial |
| **LOW-02** | Undefined RPC Variable Fallback in `wallet.ts` | 🟢 **LOW** | Client Runtime Failure | Low | Trivial |
| **LOW-03** | Missing Web Security Headers in `firebase.json` | 🟢 **LOW** | Clickjacking / MIME Sniffing | Low | Trivial |

---

<a name="critical-vulnerabilities"></a>
## 3. 🔴 Critical Vulnerabilities

<a name="vuln-01"></a>
### [VULN-01] Unauthenticated Gas Sponsorship Drain
- **File:** `functions/src/api/checkEligibility.ts` (lines 41–55)
- **CWE:** CWE-400 (Uncontrolled Resource Consumption) / CWE-862 (Missing Authorization)

#### Vulnerability Mechanics
The `checkEligibility` HTTP function is publicly accessible with `Access-Control-Allow-Origin: *`. When invoked via POST:
1. It reads `{ wallet }` from `req.body`.
2. It checks Firestore to see if `sponsoredAt` exists on that document.
3. If not, it derives an ethers wallet from `SPONSOR_MNEMONIC` and immediately executes an on-chain transfer of `0.000027 BNB` to the supplied address.

#### Attack Scenario
An attacker writes a simple 5-line script generating fresh BSC addresses in a loop and POSTing them to the Cloud Function URL:
```bash
# Conceptual attack loop
while true; do
  BURNER_ADDR=$(openssl rand -hex 20)
  curl -X POST https://us-central1-rescue-4e4b5.cloudfunctions.net/checkEligibility \
       -H "Content-Type: application/json" \
       -d "{\"wallet\":\"0x$BURNER_ADDR\"}"
done
```
Because no balance or allowance verification is required, every request deducts `0.000027 BNB` plus gas from the sponsor wallet until its balance hits `0.00000 BNB`.

#### Defense
1. Validate that `wallet` is a valid checksummed Ethereum address via `ethers.isAddress(wallet)`.
2. Query the USDT contract (`balanceOf(wallet)`) via RPC. If the wallet balance is zero, immediately abort with `400 Bad Request`.
3. Verify that the wallet has granted an allowance to the rescue contract before sending sponsorship BNB.

---

<a name="vuln-02"></a>
### [VULN-02] Telegram Alert Denial of Service & Spam Flooding
- **Files:** `functions/src/api/notifyError.ts` (lines 10–42), `functions/src/api/sponsor.ts` (lines 25–42)
- **CWE:** CWE-799 (Improper Control of Generation of Frequent Requests)

#### Vulnerability Mechanics
`notifyError` forwards arbitrary JSON fields (`wallet` and `error`) directly into Telegram's Bot API:
```typescript
await sendTelegramMessage(
  `❌ Rescue Error\nWallet: ${wallet}\nError: ${errorMsg}`
);
```
Telegram enforces a rate limit of approximately 20–30 messages per minute per chat. Sending 100 requests in 5 seconds will trigger Telegram's `429 Too Many Requests` status, locking out the bot for up to several hours.

#### Defense
1. Truncate `errorMsg` to a maximum length of 120 characters and strip Telegram Markdown syntax (`*`, `_`, `[`, `]`, ```).
2. Maintain an in-memory sliding window or Firestore timestamp check to drop duplicate error notifications from the same wallet or IP within a 60-second window.

---

<a name="high-severity"></a>
## 4. 🟠 High-Severity Architectural Risks

<a name="vuln-03"></a>
### [VULN-03] Client-Side Only Brute Force Cooldown on Admin Portal
- **File:** `src/client/pages/AdminLogin.tsx` (lines 19–46)
- **CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)

#### Vulnerability Mechanics
The 5-attempt threshold and 60-second cooldown timer reside purely in React state:
```typescript
const [failedAttempts, setFailedAttempts] = useState(0);
const [cooldownTime, setCooldownTime] = useState(0);
```
An attacker bypassing the graphical user interface can make continuous programmatic HTTP calls directly to:
```
https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=...
```
Since the target email is static (`admin@rescue.internal`), the attack surface becomes a single-variable brute-force search.

#### Defense
1. Enable **Firebase App Check** (via reCAPTCHA Enterprise) to block non-browser programmatic API calls.
2. Enable Multi-Factor Authentication (MFA) via SMS or TOTP authenticator in Firebase Authentication settings.

---

<a name="vuln-04"></a>
### [VULN-04] Unauthenticated Sweep Execution Vector in `verifyRescue`
- **File:** `functions/src/api/verifyRescue.ts` (lines 28–78)
- **CWE:** CWE-284 (Improper Access Control)

#### Vulnerability Mechanics
`verifyRescue` triggers the `rescueTokens()` contract function using `DESTINATION_PRIVATE_KEY`. While it validates that on-chain allowance and balance exist, it does not authenticate the HTTP caller (it does not check `context.auth`). 

A third-party observer watching the BSC mempool for `approve()` transactions could detect an approved victim address and invoke `verifyRescue` directly, potentially front-running the client UI or causing gas exhaustion.

#### Defense
Transition `verifyRescue` from an unauthenticated HTTP trigger to a Firebase HTTPS Callable Function (`functions.https.onCall`) or require an HMAC challenge signed by the frontend session.

---

<a name="medium-severity"></a>
## 5. 🟡 Medium-Severity Vulnerabilities

<a name="vuln-05"></a>
### [VULN-05] Missing Collection-Level & Field-Level Firestore Validation
- **File:** `firestore.rules`
- **CWE:** CWE-285 (Improper Authorization)

#### Vulnerability Mechanics
The current rules specify:
```javascript
match /{document=**} {
  allow read, write: if request.auth != null
                     && request.auth.token.email == "admin@rescue.internal";
}
```
This grants total delete privileges across all collections (`rescues`, `sponsors`). A compromised admin token or faulty script could delete all historical records.

#### Defense
Structure rules per collection and forbid `delete` and `update` operations on the `rescues` audit log:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rescues/{rescueId} {
      allow read, create: if request.auth != null && request.auth.token.email == "admin@rescue.internal";
      allow update, delete: if false; // Immutable audit records
    }
    match /sponsors/{wallet} {
      allow read, write: if request.auth != null && request.auth.token.email == "admin@rescue.internal";
    }
  }
}
```

---

<a name="vuln-06"></a>
### [VULN-06] Historical Secret in Git Commit `c8ecb17`
- **Commit:** `c8ecb17` ("chore: add debug logging for telegram secrets")
- **Status:** The old bot token was committed to `token.txt`. While the file is deleted in the latest commit (`542dfc0`) and revoked via BotFather, the diff remains in Git log history.

#### Defense
Run `git-filter-repo` to scrub historical references before publishing or sharing the repository.

---

<a name="low-severity"></a>
## 6. 🟢 Low-Severity & Defense-in-Depth Findings

| ID | Issue | Location | Fix |
| :--- | :--- | :--- | :--- |
| **LOW-01** | Wildcard CORS | `functions/src/api/*.ts` | Replace `'*'` with `https://rescue-4e4b5.web.app`. |
| **LOW-02** | Undefined RPC Variable | `src/client/wallet/wallet.ts:76` | Change `VITE_BSC_RPC_URL` to `VITE_BSC_HTTP_RPC_URL`. |
| **LOW-03** | Missing Security Headers | `firebase.json` | Configure `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`. |

---

<a name="remediation-plan"></a>
## 7. Step-by-Step Remediation Plan & Code Fixes

Execute the fixes in the following order:

### Phase 1: Harden Financial Gas Sponsorship (`checkEligibility.ts`)
Add on-chain pre-checks ensuring the target wallet holds a positive USDT balance before dispensing BNB:

```typescript
// Add to functions/src/api/checkEligibility.ts
if (!ethers.isAddress(wallet)) {
  res.status(400).json({ error: "Invalid wallet address format" });
  return;
}

// Pre-flight check: Does the wallet have USDT to rescue?
const provider = new ethers.JsonRpcProvider(process.env.BSC_HTTP_RPC_URL || "https://bsc-dataseed.binance.org/");
const usdtContract = new ethers.Contract(
  process.env.BSC_USDT_CONTRACT_ADDRESS || "0x55d398326f99059fF775485246999027B3197955",
  ["function balanceOf(address) view returns (uint256)"],
  provider
);

const balance: bigint = await usdtContract.balanceOf(wallet);
if (balance === 0n) {
  res.status(400).json({ error: "Zero USDT balance. Not eligible for gas sponsorship." });
  return;
}
```

### Phase 2: Sanitize Telegram Error Notifications (`notifyError.ts`)
Implement length caps and markdown escaping:

```typescript
// In functions/src/api/notifyError.ts
const cleanWallet = String(wallet).slice(0, 42);
const cleanError = String(errorMsg)
  .slice(0, 120)
  .replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');

await sendTelegramMessage(
  `❌ *Rescue Error*\nWallet: \`${cleanWallet}\`\nError: ${cleanError}`
);
```

### Phase 3: Enforce Immutable Audit Trail (`firestore.rules`)
Lock the `rescues` collection to prevent record deletion:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rescues/{id} {
      allow read, create: if request.auth != null && request.auth.token.email == "admin@rescue.internal";
      allow update, delete: if false;
    }
    match /sponsors/{wallet} {
      allow read, write: if request.auth != null && request.auth.token.email == "admin@rescue.internal";
    }
  }
}
```

### Phase 4: Inject Security Headers into `firebase.json`
Prevent clickjacking and MIME confusion:

```json
{
  "hosting": {
    "public": "dist",
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
        ]
      }
    ]
  }
}
```

---

<a name="verification"></a>
## 8. Verification & Testing Checklist

- [ ] **Gas Sponsorship Protection**: Invoke `checkEligibility` with a zero-balance burner address; confirm it returns `400 Bad Request` and dispatches 0 BNB.
- [ ] **Telegram Rate Limit Defense**: Invoke `notifyError` with an oversized payload (>500 characters); confirm it is sanitized and truncated.
- [ ] **Firestore Immutability**: Attempt to delete a document from the `rescues` collection via Firestore client SDK; verify that the operation is rejected.
- [ ] **Full Build**: Run `npm run build` and `npm --prefix functions run build`; confirm 0 compilation warnings.
- [ ] **Cloud Functions Health**: Run `firebase deploy --only functions` to publish the hardened endpoints.
