# Security & Environment Implementation Plan

**Project:** `rescue-4e4b5` — BSC USDT Rescue via Firebase + Cloud Functions  
**Prepared:** 2026-10-17  
**Status:** ⏳ Awaiting Review  

> This document must be reviewed and approved before any code is written or committed.  
> Each vulnerability section explains **what it is**, **why it is dangerous**, **exactly what to change**, and **how to verify the fix**.

---

## Table of Contents

1. [🔴 CRIT-01 — Live Telegram Bot Token on Disk](#crit-01)
2. [🔴 CRIT-02 — Firebase API Key Hardcoded as Source-Code Fallback](#crit-02)
3. [🟠 HIGH-01 — Dual `firebase.json` Causes Silent Wrong-Target Deploys](#high-01)
4. [🟠 HIGH-02 — `token.txt` Not Covered by Inner `.gitignore`](#high-02)
5. [🟡 MED-01 — Nested `.git` Repos Without Submodule Declaration](#med-01)
6. [🟡 MED-02 — Dead Firestore Security Rule Creates a False Safety Signal](#med-02)
7. [🟡 MED-03 — `node: "24"` Targets an Unsupported Firebase Functions Runtime](#med-03)
8. [🟢 LOW-01 — `.vscode/` Ignored Inconsistently Across Repos](#low-01)
9. [🟢 LOW-02 — IDE-Specific Metadata Directories Not Ignored](#low-02)
10. [Phase Summary & Commit Order](#phase-summary)

---

<a name="crit-01"></a>
## 🔴 CRIT-01 — Live Telegram Bot Token on Disk

### Severity
**Critical** — Immediate action required before any other step.

### What It Is
The file `bsc-usdt-rescue/token.txt` contains a live Telegram Bot API token:

```
8960219400:AAHRsBs4uQPU5K8j41cJzKTXCe4KxDPEXPk
```

This token is stored as a plain text file in the project directory.

### Why It Is Dangerous

A Telegram Bot token is equivalent to a root password for that bot. Anyone who obtains it can:

- **Impersonate the bot** — send messages to every user who has ever interacted with it, including your admin Telegram chat.
- **Read all historical messages** the bot has received (depending on privacy settings), potentially exposing wallet addresses, transaction hashes, or internal operational data your bot has processed.
- **Delete the bot's webhook** — silently breaking your rescue operation notifications with no error visible on your end.
- **Send fake "rescue complete" alerts** to your Telegram monitoring channel, causing you to believe transactions succeeded when they have not.
- **Enumerate your Telegram Chat ID** from any message the bot has received, which combined with the token gives full control of your notification pipeline.

This token is also referenced in `.env.example` as `TELEGRAM_BOT_TOKEN`. If the live token was ever placed inside any `.env` file that was staged even briefly, it may be in git history and is compromised regardless of whether the file was later removed.

### The Fix

**Step 1 — Revoke the token immediately (do this before reading anything else)**

1. Open Telegram and message `@BotFather`.
2. Send `/mybots`.
3. Select your rescue bot from the list.
4. Tap **API Token** → **Revoke current token**.
5. Copy the newly generated token. The old one is now dead.

**Step 2 — Delete the file**

```bash
# From the bsc-usdt-rescue directory
Remove-Item "bsc-usdt-rescue\token.txt"
```

**Step 3 — Check git history for the file**

```bash
git -C "bsc-usdt-rescue" log --all --full-history --oneline -- token.txt
```

If any commits appear, the token has been in git history. Even after deletion, anyone who cloned or forked the repo before deletion retains the old token. The revocation in Step 1 neutralises this — but you must still purge the file from history if the repo is or will be pushed remotely:

```bash
# Nuclear option — rewrites history. Only safe before the repo is shared.
git -C "bsc-usdt-rescue" filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch token.txt" \
  --prune-empty --tag-name-filter cat -- --all
```

**Step 4 — Store the new token correctly**

The new token must go into Cloudflare Worker secrets (never in any file):

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
# Paste the new token when prompted. It is encrypted at rest, never visible in code.
```

For local development, add it to `bsc-usdt-rescue/.env` (which is `.gitignore`'d):

```env
TELEGRAM_BOT_TOKEN=<new_token_here>
```

**Step 5 — Add `token.txt` to the inner `.gitignore`** (also covered in HIGH-02 below)

```
# bsc-usdt-rescue/.gitignore — add this line
token.txt
```

### Verification

- Attempt to use the old token via curl. It should return `{"ok":false,"error_code":401,"description":"Unauthorized"}`.
- Confirm `token.txt` does not appear in `git status` output.
- Confirm the new token is stored only via `wrangler secret list` (shows the key name, not the value).

---

<a name="crit-02"></a>
## 🔴 CRIT-02 — Firebase API Key Hardcoded as Source-Code Fallback

### Severity
**Critical** — Will be bundled into production JavaScript and permanently visible in git history.

### What It Is

Two source files use real Firebase credentials as hardcoded fallback values:

**`bsc-usdt-rescue/src/client/config/firebase.ts`** (lines 8–14):
```ts
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDm8hjaEHVus9WlBemFGYrp_UcVZ4MdhEA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rescue-4e4b5.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rescue-4e4b5",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rescue-4e4b5.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1069735572173",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1069735572173:web:47c14d69015807e6d62f84",
};
```

**`bsc-usdt-rescue/scripts/create-admin-user.mjs`** (line 3):
```js
const API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyDm8hjaEHVus9WlBemFGYrp_UcVZ4MdhEA";
```

### Why It Is Dangerous

**Misconception to dispel first:** Firebase web API keys are intentionally semi-public — they are embedded in every deployed web app and visible in the browser. They are not secret in the way a private key is. However, hardcoding them as source fallbacks creates two distinct problems:

**Problem 1 — The fallback defeats environment isolation.**  
The entire point of environment variables is that `dev`, `staging`, and `prod` use different credentials. With a hardcoded fallback, if a developer forgets to create a `.env` file (or the CI pipeline lacks one), the app silently runs against the **production Firebase project** with no warning. A developer running tests locally could mutate production Firestore data thinking they are in a dev environment.

**Problem 2 — The project ID and app configuration are permanently in git history.**  
Project ID `rescue-4e4b5`, messaging sender ID `1069735572173`, and app ID `1:1069735572173:web:47c14d69015807e6d62f84` are now immutably committed. An attacker can use the project ID to:
- Enumerate Firebase Hosting URLs (`rescue-4e4b5.web.app`, `rescue-4e4b5.firebaseapp.com`).
- Attempt abuse of any unrestricted Firebase API key via the Identity Toolkit (sign-up flooding, auth enumeration).
- Target your Cloud Functions endpoint `https://us-central1-rescue-4e4b5.cloudfunctions.net` directly.

**Problem 3 — The `create-admin-user.mjs` script creates a Firebase auth account using the API key.**  
If this script is run without a `.env` file (e.g., in a fresh clone on a new machine), it makes a live API call to create an admin user in production, using the hardcoded key, without any confirmation prompt.

### The Fix

**`src/client/config/firebase.ts` — remove all fallback strings:**

```ts
// BEFORE (dangerous)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDm8hjaEHVus9WlBemFGYrp_UcVZ4MdhEA",
  // ...
};

// AFTER (safe)
const requiredEnvVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

for (const key of requiredEnvVars) {
  if (!import.meta.env[key]) {
    throw new Error(`[Config] Missing required environment variable: ${key}. Copy .env.example to .env and fill in the values.`);
  }
}

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};
```

**`scripts/create-admin-user.mjs` — remove the fallback and add a guard:**

```js
// BEFORE (dangerous)
const API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyDm8hjaEHVus9WlBemFGYrp_UcVZ4MdhEA";

// AFTER (safe)
const API_KEY = process.env.VITE_FIREBASE_API_KEY;
if (!API_KEY) {
  console.error('Error: VITE_FIREBASE_API_KEY is not set. Load your .env file before running this script.');
  console.error('  Example: node --env-file=.env scripts/create-admin-user.mjs <email> <password>');
  process.exit(1);
}
```

**Restrict the Firebase API key in the Google Cloud Console:**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials.
2. Click the web API key for project `rescue-4e4b5`.
3. Under **Application restrictions**, select **HTTP referrers (websites)**.
4. Add your hosting domains:
   - `rescue-4e4b5.web.app/*`
   - `rescue-4e4b5.firebaseapp.com/*`
   - `localhost:5000/*` (for local emulator use)
5. Under **API restrictions**, restrict to only the APIs your app uses (Identity Toolkit, Firestore, etc.). Do not leave it as "Don't restrict".
6. Save.

After this restriction, the hardcoded key is useless from any domain other than yours — but you should still remove it from source code.

### Verification

- Run `npm run build` inside `bsc-usdt-rescue/` without a `.env` file present. The build should throw the missing env var error and exit non-zero.
- Grep the compiled `dist/` output for the old API key string — it must not appear.
- Confirm the Firebase Console → Project Settings → Your apps shows the key has domain restrictions applied.

---

<a name="high-01"></a>
## 🟠 HIGH-01 — Dual `firebase.json` Causes Silent Wrong-Target Deploys

### Severity
**High** — Can silently overwrite production Cloud Functions with a stub.

### What It Is

There are two separate `firebase.json` files in this workspace:

| File | Location | What It Configures |
|---|---|---|
| `firebase.json` (outer) | `d:\Desktop\rescue script\firebase.json` | Functions only → points to outer `functions/src/index.ts` (a stub with no exports) |
| `firebase.json` (inner) | `bsc-usdt-rescue\firebase.json` | Hosting + Firestore + Functions → points to inner `bsc-usdt-rescue\functions\` (the real app) |

Both reference project `rescue-4e4b5` via their respective `.firebaserc` files.

### Why It Is Dangerous

The Firebase CLI uses whichever `firebase.json` is in the current working directory when you run `firebase deploy`. There is no confirmation prompt, no diff, and no warning that you may be in the wrong directory.

**Scenario:** A developer opens a terminal, `cd`s to `d:\Desktop\rescue script\`, and runs `firebase deploy --only functions`. Firebase will:
1. Find the outer `firebase.json`.
2. Look at the outer `functions/src/index.ts`.
3. Deploy that file — which contains only `setGlobalOptions({maxInstances: 10})` and zero exported functions.
4. **Overwrite all live Cloud Functions in `rescue-4e4b5` with an empty deployment.**

Your rescue operation goes offline instantly, with no error message. You would see `Deploy complete!` in the terminal.

Additionally, the two `firebase.json` files have inconsistent configurations:
- The outer one has `"disallowLegacyRuntimeConfig": true` and `predeploy` lint/build steps.
- The inner one has neither, meaning deploying from the inner directory skips linting.

### The Fix

**Decision required:** Choose one of the following two approaches.

---

**Option A (Recommended) — Single authoritative deploy root**

The real application lives in `bsc-usdt-rescue/`. Make that the single Firebase project root. The outer `rescue script/` directory becomes a workspace container only — no `firebase.json`, no Firebase CLI usage from there.

Steps:
1. Delete `d:\Desktop\rescue script\firebase.json`.
2. Delete `d:\Desktop\rescue script\.firebaserc`.
3. Delete the outer `d:\Desktop\rescue script\functions\` directory (it is a stub and is superseded by `bsc-usdt-rescue\functions\`).
4. All `firebase` CLI commands must now be run from `bsc-usdt-rescue\`.
5. Add a root-level `README.md` note: _"Firebase CLI must be run from `bsc-usdt-rescue/`."_

Optionally add a safety script to `d:\Desktop\rescue script\package.json`:
```json
{
  "scripts": {
    "deploy": "echo 'ERROR: Run firebase commands from bsc-usdt-rescue/, not the root.' && exit 1"
  }
}
```

---

**Option B — Keep both, add a predeploy guard in the inner `firebase.json`**

If the outer functions directory serves a purpose (e.g., a separate admin Cloud Functions codebase), keep both but harden the inner one:

Update `bsc-usdt-rescue/firebase.json` functions config to match the outer one's safety settings:
```json
{
  "functions": {
    "source": "functions",
    "codebase": "default",
    "disallowLegacyRuntimeConfig": true,
    "ignore": ["node_modules", ".git", "firebase-debug.log", "*.local"],
    "predeploy": [
      "npm --prefix \"$RESOURCE_DIR\" run lint",
      "npm --prefix \"$RESOURCE_DIR\" run build"
    ]
  }
}
```

And add a `package.json` script at the outer root that explicitly errors on deploy:
```json
"predeploy": "echo 'Deploy from bsc-usdt-rescue/ only' && exit 1"
```

### Verification

- From `d:\Desktop\rescue script\`, run `firebase deploy --dry-run` (if Option A). It should fail with "no firebase.json found".
- From `bsc-usdt-rescue\`, run `firebase deploy --dry-run`. It should show the correct functions, hosting, and Firestore targets.

---

<a name="high-02"></a>
## 🟠 HIGH-02 — `token.txt` Not Covered by Inner `.gitignore`

### Severity
**High** — The credential file from CRIT-01 has no gitignore protection in the repo that contains it.

### What It Is

`bsc-usdt-rescue/.gitignore` does not include `token.txt`. The outer root `.gitignore` does not apply to files inside `bsc-usdt-rescue/` when it has its own `.git` directory (which it does). There is therefore no git-level barrier preventing `token.txt` from being staged and committed.

### Why It Is Dangerous

This is the mechanism that allowed the token to sit on disk without triggering a git warning. If the inner repo had included `token.txt` in its `.gitignore`, running `git status` would have shown nothing and the risk would have been contained to the local machine. Without the entry, any `git add .` or `git add -A` silently stages the token for commit.

### The Fix

Add the following entries to `bsc-usdt-rescue/.gitignore`:

```gitignore
# Secrets — never commit these
token.txt
*.pem
*.key
*service-account*.json
*-adminsdk*.json
.env
.env.local
.env.*.local

# Runtime artifacts
firebase-debug.log
firestore-debug.log
.firebase/

# Build outputs
dist/
functions/lib/
functions/node_modules/

# Cloudflare
.wrangler/

# Logs
logs.txt
```

Note: several of these (`dist/`, `.env`, `functions/node_modules/`, `logs.txt`) are already present. The additions are `token.txt`, `*.pem`, `*.key`, the service account patterns, `.firebase/`, `firestore-debug.log`, and `.wrangler/`.

### Verification

- Add an empty `token.txt` to `bsc-usdt-rescue/` and run `git -C bsc-usdt-rescue status`. It must not appear in the output.
- Run `git -C bsc-usdt-rescue check-ignore -v token.txt`. It should output the `.gitignore` rule that matches it.

---

<a name="med-01"></a>
## 🟡 MED-01 — Nested `.git` Repos Without Submodule Declaration

### Severity
**Medium** — Causes unpredictable behavior in IDE git panels, Firebase CLI, and CI pipelines.

### What It Is

`bsc-usdt-rescue/` contains its own `.git` directory (a fully independent git repository). The outer `d:\Desktop\rescue script\` directory does not currently have a `.git` directory — but it has `firebase.json`, `.firebaserc`, `.gitignore`, and other files structured as if it intends to be a repo root.

This is an ambiguous state: the outer folder is "repo-shaped" but not initialised, while the inner folder is a complete independent repo nested inside it.

### Why It Is Dangerous

**If the outer folder is later initialised as a git repo** (which is the natural next step given its structure), Git will treat `bsc-usdt-rescue/` as an untracked directory — it will not track its contents, it will not commit its files, and it will silently appear as a single uncommitted folder in `git status`. A developer seeing `bsc-usdt-rescue/` listed as "untracked" and running `git add bsc-usdt-rescue/` will not add any of its files — they will just add the submodule reference, probably without realising it.

**For the Firebase CLI:** `firebase deploy` traverses upward looking for `firebase.json`. If the CLI is run from a subdirectory of `bsc-usdt-rescue/`, it may find the inner `firebase.json` correctly. But if the outer directory is initialised and the developer runs commands there, the CLI finds the outer `firebase.json` first (see HIGH-01).

**For VS Code / Cursor / Kiro:** The IDE's Source Control panel shows git state from the workspace root. With nested `.git` directories, some IDEs show only the outer repo's state and silently ignore the inner one, making it appear as if the app's code is not version-controlled.

### The Fix

Make an explicit architectural decision now. Two clean options:

---

**Option A (Recommended) — Flatten: make `bsc-usdt-rescue/` the single repo root**

This works if the outer `rescue script/` directory is just a container and has no unique content that needs versioning.

```powershell
# 1. Move the real project up
Move-Item "bsc-usdt-rescue\*" "." -Force   # move all inner files to outer root
Move-Item "bsc-usdt-rescue\.git" "."       # move the git history
Move-Item "bsc-usdt-rescue\.gitignore" "." # keep the correct .gitignore
Remove-Item "bsc-usdt-rescue" -Recurse     # remove now-empty inner folder

# 2. Remove the outer firebase.json and functions stub (covered in HIGH-01)
Remove-Item "firebase.json"
Remove-Item "functions" -Recurse

# 3. Verify
git status   # should show the project files cleanly
```

---

**Option B — Declare as a git submodule**

If the outer repo needs to exist as a mono-repo that also tracks the `bsc-usdt-rescue` project:

```bash
# 1. Initialise the outer repo
git init

# 2. Add the inner repo as a submodule
git submodule add ./bsc-usdt-rescue bsc-usdt-rescue

# 3. Commit the submodule declaration
git add .gitmodules bsc-usdt-rescue
git commit -m "chore: add bsc-usdt-rescue as submodule"
```

Submodules add operational complexity (teammates must run `git submodule update --init` after cloning). Only choose Option B if the outer repo will genuinely contain other independent projects.

### Verification

- Run `git status` from the chosen root. All project files should appear as tracked/untracked — not as a nested repo entry.
- Run `git log --oneline -5` to confirm history is intact.

---

<a name="med-02"></a>
## 🟡 MED-02 — Dead Firestore Security Rule Creates a False Safety Signal

### Severity
**Medium** — Does not introduce a new vulnerability, but masks the actual access model and will mislead any future developer editing the rules.

### What It Is

`bsc-usdt-rescue/firestore.rules` contains two overlapping wildcard rules:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Rule 1: Admin gets full access
    match /{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.token.email == "admin@rescue.internal";
    }

    // Rule 2: Everyone else denied
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Why It Is Dangerous

In Firebase Security Rules, when two rules match the same path, **access is granted if any one of them returns `true`**. The rules use an "OR" evaluation model, not "last wins".

This means Rule 2 (`allow ... if false`) never has any effect. It can never grant access (because `false` is always false), and it cannot revoke access granted by Rule 1. It is completely inert.

The danger is not what the rules do today — they are effectively correct. The danger is what a future developer will believe about them:

- A developer could read Rule 2 and believe it provides a "deny all" fallback that protects against Rule 1 being accidentally broadened.
- They might then add a Rule 3 that is overly permissive, thinking Rule 2 would catch it — but it won't.
- Or they might remove Rule 2 thinking it's a duplicate, not realising its removal changes nothing but believing they've "tightened" the rules.

There is also a secondary concern: the admin check relies on a **single hardcoded email address** (`admin@rescue.internal`). This is a single point of failure — if that email is ever compromised, disabled, or accidentally deleted from Firebase Auth, there is no fallback admin access path. All admin operations would be permanently locked out unless you use the Firebase Console directly.

### The Fix

**Rewrite the rules with explicit, commented intent:**

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── All direct client reads/writes are denied by default ──────────────
    // The only path to write data is via Cloud Functions using the Admin SDK,
    // which bypasses these rules entirely. Direct client access is intentionally
    // prohibited except for the admin portal below.
    match /{document=**} {
      allow read, write: if false;
    }

    // ── Admin portal: verified admin email gets full access ───────────────
    // This rule is an OVERRIDE of the deny-all above for the admin use case.
    // Firebase evaluates all matching rules and grants access if ANY returns true.
    // The admin email must match exactly and the user must be authenticated.
    match /{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.token.email == "admin@rescue.internal";
    }

  }
}
```

> Note: The rule order is now reversed (deny-all first, admin override second). This does not change the runtime behavior — Firebase's OR model makes order irrelevant — but it documents intent correctly: "deny everything, except for the admin override below."

**Additionally, consider using a custom claim instead of email matching:**

Email addresses can be changed. A custom claim is immutable unless you explicitly revoke it via the Admin SDK:

```ts
// In your Cloud Function or admin setup script:
await admin.auth().setCustomUserClaims(uid, { role: 'admin' });
```

```js
// In Firestore rules:
allow read, write: if request.auth != null
                   && request.auth.token.role == 'admin';
```

This prevents an admin lockout if the email is ever modified.

### Verification

- Deploy the updated rules: `firebase deploy --only firestore:rules`
- In the Firebase Console → Firestore → Rules → Rules Playground:
  - Simulate a read from an **unauthenticated** user → must be **Denied**.
  - Simulate a read from a user with email `admin@rescue.internal` → must be **Allowed**.
  - Simulate a read from a user with a different authenticated email → must be **Denied**.

---

<a name="med-03"></a>
## 🟡 MED-03 — `node: "24"` Targets an Unsupported Firebase Functions Runtime

### Severity
**Medium** — Will cause deployment to fail or silently fall back to an unsupported runtime.

### What It Is

`d:\Desktop\rescue script\functions\package.json` specifies:

```json
"engines": {
  "node": "24"
}
```

`bsc-usdt-rescue\functions\package.json` should be checked for the same.

### Why It Is Dangerous

Firebase Cloud Functions only supports specific Node.js runtime versions. As of October 2026, the supported runtimes are Node.js 18, 20, and 22. Node 24 is not yet a GA Firebase Functions runtime.

Attempting to deploy with `node: "24"` will result in one of two outcomes:
- **Deploy failure** — Firebase CLI validates the engine field and rejects the deployment with an error like `"Unsupported Node.js version"`.
- **Silently falls back** — In some CLI versions, Firebase ignores the `engines` field and deploys using its own default Node version, which may be 18 or 20, not 24. Your functions then run on a different Node version than your development environment, potentially causing subtle bugs (different `crypto` APIs, different V8 behavior, different ESM/CJS resolution).

Either outcome is bad. The first halts your deployment pipeline. The second creates an invisible environment mismatch that only surfaces as a runtime error in production.

Additionally, the outer `functions/package.json` also specifies `"node": "24"` with `typescript: "^6.0.0"` — TypeScript 6 is not yet released at this date, which will cause `npm install` to fail in the outer functions directory.

### The Fix

**`functions/package.json` (both outer and inner) — update the engines field:**

```json
// BEFORE
"engines": {
  "node": "24"
}

// AFTER
"engines": {
  "node": "22"
}
```

Node 22 is the current LTS and is fully supported by Firebase Functions Gen 2. It also aligns with the Node version you have installed (`v22.17.0` as seen in the debug log).

**Also fix `typescript` in the outer `functions/package.json`:**

```json
// BEFORE
"typescript": "^6.0.0"

// AFTER
"typescript": "^5.4.5"   // latest stable, matches bsc-usdt-rescue devDependencies
```

**Update `firebase.json` to explicitly declare the runtime:**

In `bsc-usdt-rescue/firebase.json`:
```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs22",
    ...
  }
}
```

Explicitly declaring the runtime in `firebase.json` takes precedence over the `engines` field and makes the target version unambiguous.

### Verification

- Run `firebase deploy --only functions --dry-run` from `bsc-usdt-rescue/`.
- Confirm the CLI output mentions `nodejs22` as the target runtime.
- Run `node --version` locally — should output `v22.x.x`.

---

<a name="low-01"></a>
## 🟢 LOW-01 — `.vscode/` Ignored Inconsistently Across Repos

### Severity
**Low** — Causes inconsistent IDE behavior across team members and IDEs.

### What It Is

The root `.gitignore` includes `.vscode/`:
```
.vscode/
```

This means VS Code workspace settings, launch configurations, and extension recommendations are not committed. The inner `bsc-usdt-rescue/.gitignore` does not mention `.vscode/` at all.

### Why It Matters

`.vscode/settings.json` and `.vscode/extensions.json` are workspace-level configuration that is genuinely useful to share (recommended extensions, formatting rules, TypeScript SDK path, etc.). Ignoring them means:

- Each developer must manually configure their IDE after cloning.
- Cursor, Kiro, and VS Code may behave differently for different team members because they each independently configure their workspace.
- Shared launch configurations for the Firebase emulator (`"runtimeArgs": ["--inspect"]`, port settings) cannot be committed.

### The Fix

**Decision: commit the `.vscode/` folder or ignore it universally.**

If you want shared settings (recommended for a multi-IDE setup):

- Remove `.vscode/` from the root `.gitignore`.
- Add `bsc-usdt-rescue/.vscode/` to a commit.
- Commit a minimal `settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib",
  "eslint.workingDirectories": ["./functions"]
}
```

- Commit an `extensions.json`:

```json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "firebase.vscode-firebase-explorer"
  ]
}
```

If you explicitly do not want shared settings, make the ignore consistent across both repos:

```gitignore
# Add to bsc-usdt-rescue/.gitignore
.vscode/
.idea/
```

### Verification

- After choosing an approach, run `git status` and confirm `.vscode/` either appears cleanly in the tracked files or is suppressed by `.gitignore`.

---

<a name="low-02"></a>
## 🟢 LOW-02 — IDE-Specific Metadata Directories Not Ignored

### Severity
**Low** — Pollutes the repository with machine-specific tooling data.

### What It Is

The workspace root contains directories for three separate IDE/agent tools:

| Directory | Tool |
|---|---|
| `.vscode/` | Visual Studio Code |
| `.cursor/` | Cursor IDE |
| `.claude/` | Claude Code agent |
| `.agents/` | Kiro agent skills cache |
| `skills-lock.json` | Kiro skills lockfile |

None of `.cursor/`, `.claude/`, `.agents/`, or `skills-lock.json` are in any `.gitignore`.

### Why It Matters

- `.cursor/` contains Cursor-specific index data, model context caches, and sometimes API key references scoped to your workspace. Committing it shares your AI tool configuration with collaborators who may use different tools — or exposes configuration paths.
- `.claude/` similarly contains Claude Code's session state and project context. This can include cached file summaries and conversation context that you may not want in the project history.
- `.agents/` in this workspace contains Firebase skill reference documents fetched by the Kiro agent. These are auto-managed by the tool and will change frequently, creating noisy commits.
- `skills-lock.json` is a Kiro lockfile (analogous to `package-lock.json` for agent skills). It is auto-generated and should not be manually edited or committed unless you explicitly want to pin skill versions.

### The Fix

Add to the root `.gitignore`:

```gitignore
# AI/IDE tooling — machine-specific, auto-generated
.cursor/
.claude/
.agents/
skills-lock.json

# If not committing VS Code settings (see LOW-01)
.vscode/
```

If you decide to commit `.vscode/` (per LOW-01), keep it out of this ignore block but make sure `.cursor/` and `.claude/` remain ignored.

### Verification

- Run `git status` from the workspace root.
- Confirm `.cursor/`, `.claude/`, `.agents/`, and `skills-lock.json` do not appear as untracked files.

---

<a name="phase-summary"></a>
## Phase Summary & Commit Order

Execute in this exact order. Do not skip phases — each one is a dependency of the next.

### Phase 1 — Credential Revocation (No Code Written Yet)

| # | Action | Covers |
|---|---|---|
| 1.1 | Revoke Telegram bot token via BotFather | CRIT-01 |
| 1.2 | Delete `bsc-usdt-rescue/token.txt` | CRIT-01 |
| 1.3 | Audit inner git log for committed secrets | CRIT-01, HIGH-02 |
| 1.4 | Store new Telegram token in `wrangler secret put` | CRIT-01 |
| 1.5 | Rotate Firebase API key in Google Cloud Console | CRIT-02 |
| 1.6 | Restrict Firebase API key to hosting domains | CRIT-02 |

### Phase 2 — Repository Structure

| # | Action | Covers |
|---|---|---|
| 2.1 | Choose Option A or B for repo structure | MED-01 |
| 2.2 | Flatten or declare submodule | MED-01 |
| 2.3 | Remove outer `firebase.json` and stub `functions/` (if Option A) | HIGH-01 |
| 2.4 | Update `bsc-usdt-rescue/.gitignore` with missing entries | HIGH-02 |
| 2.5 | Update root `.gitignore` with IDE tool entries | LOW-02 |
| 2.6 | Decide on `.vscode/` commit strategy | LOW-01 |

### Phase 3 — Configuration Hardening

| # | Action | Covers |
|---|---|---|
| 3.1 | Remove hardcoded fallbacks from `firebase.ts` | CRIT-02 |
| 3.2 | Remove hardcoded fallback from `create-admin-user.mjs` | CRIT-02 |
| 3.3 | Create `bsc-usdt-rescue/.env` from `.env.example` | CRIT-02 |
| 3.4 | Fix `engines.node` to `"22"` in `functions/package.json` | MED-03 |
| 3.5 | Fix `typescript` version in outer `functions/package.json` | MED-03 |
| 3.6 | Add `"runtime": "nodejs22"` to `bsc-usdt-rescue/firebase.json` | MED-03 |

### Phase 4 — Security Rules & Firebase Setup

| # | Action | Covers |
|---|---|---|
| 4.1 | Rewrite `firestore.rules` with corrected intent | MED-02 |
| 4.2 | (Optional) Switch admin check to custom claim | MED-02 |
| 4.3 | Add Firebase emulator config to `firebase.json` | HIGH-01 |
| 4.4 | Store all server-side secrets via `firebase functions:secrets:set` | CRIT-01, CRIT-02 |
| 4.5 | Deploy and verify rules via Firestore Rules Playground | MED-02 |

### Phase 5 — First Safe Commit

```bash
# Stage only known-safe files
git add .gitignore firebase.json firestore.rules
git add src/ functions/src/
git add .env.example
git add README.md

# Verify nothing sensitive is staged
git diff --staged | Select-String -Pattern "apiKey|private|token|password|secret" -CaseSensitive

# Commit
git commit -m "chore: initial secure setup — credentials externalized, rules hardened"
```

---

## Reference: Files Changed Per Vulnerability

| File | Changes | Vulnerability |
|---|---|---|
| `bsc-usdt-rescue/token.txt` | **Delete file** | CRIT-01 |
| `bsc-usdt-rescue/.gitignore` | Add `token.txt`, `*.pem`, `*.key`, service account patterns, `.wrangler/`, `firestore-debug.log` | HIGH-02 |
| `bsc-usdt-rescue/src/client/config/firebase.ts` | Remove all hardcoded fallback strings, add startup validation | CRIT-02 |
| `bsc-usdt-rescue/scripts/create-admin-user.mjs` | Remove hardcoded API key fallback, add guard | CRIT-02 |
| `d:\Desktop\rescue script\firebase.json` | **Delete file** (if Option A) | HIGH-01 |
| `d:\Desktop\rescue script\functions\` | **Delete directory** (if Option A) | HIGH-01 |
| `bsc-usdt-rescue/firebase.json` | Add `"runtime": "nodejs22"`, predeploy lint/build, emulator config | HIGH-01, MED-03 |
| `bsc-usdt-rescue/functions/package.json` | Change `engines.node` to `"22"` | MED-03 |
| `bsc-usdt-rescue/firestore.rules` | Reorder and comment rules clearly | MED-02 |
| Root `.gitignore` | Add `.cursor/`, `.claude/`, `.agents/`, `skills-lock.json`, `firebase-debug.log`, `token.txt` | LOW-02 |

---

*Review complete. Approve each phase before implementation begins.*
