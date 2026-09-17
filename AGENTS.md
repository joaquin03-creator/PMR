# Project Instructions & Briefing: Preferred Metals & Recycling (PMR)

> **Read this first, every session.** This is the living memory of the project. It exists so you can pick up work without re-explaining history. If something here is out of date, flag it and update it as part of your work.

---

## 0. What this app is

A point-of-sale + Ohio state compliance application for **Preferred Metals & Recycling (PMR)**, a boutique indoor non-ferrous scrap metal buying facility in Cincinnati, OH. It handles buy tickets, customer identity capture, cash drawer reconciliation, inventory, material conversions, invoicing, and — critically — **Ohio ORC 4737 scrap dealer compliance reporting**.

**Owner/developer:** Joaquin (co-owner, 20+ yrs telecom/network/security background, USAF veteran). Non-technical staff: Tiffany (co-owner, runs the pay window/cash drawer), Isaiah (yard staff).

**Stack:** React + TypeScript + Vite + Tailwind + Express (full-stack) + Firebase (Firestore + Auth + Hosting).

---

## 1. CRITICAL — Do not break these (compliance & money)

These are load-bearing. Changes near them require reading the lock file, making additive-only changes, and verifying against the lock. **When in doubt, ask before altering.**

### 1a. Cash reconciliation math is LOCKED
- **File of record:** `src/lib/cashLogicLock.ts` — documents the exact production formulas. A self-test (`runCashLogicSelfTest()`) runs live on history updates and must stay at 0 violations.
- **The formulas — never alter:**
  - `expectedCash = openingCash + totalReplenishments - totalPayouts - totalExpenses`
  - `actualCash = calculateDenomTotal(closingDenominations)`
  - `overShort = actualCash - expectedCash`
  - `roundMoney = Math.round(val * 100) / 100`
- Statuses: `'open' | 'closed' | 'provisional'`. `closingDenominations` is the single field of record. Audit is **append-only** (enforced in `firestore.rules` with `allow update: if false`).
- Any money change follows this discipline: (1) read the lock, (2) additive-only change, (3) verify against lock with quoted code. This same discipline is what finally beat the Ohio schema.

### 1b. Ohio ORC 4737 XML compliance format is HARD-WON — verified accepted by the state
- The XML format took **five live portal rejection cycles** to crack. The published Ohio error-code docs were misleading; the truth came from the state's official sample XML.
- **Golden reference:** an accepted file (`ohio_scrap_report_2026-07-23.xml`) was accepted first-try with zero errors. Treat its structure as canonical.
- **Format facts that are counterintuitive and must be preserved:**
  - `weightOfBulkContainers` = per-container index-weight PAIRS, e.g. `"1-10,2-20"` — NOT a total.
  - `recycMaterilasNotSpecialPurchaseArticles` = code-WEIGHT pairs, e.g. `"11-10,14-20"` — NOT bare codes.
  - `metalArticlesNotRecyclableDesc` and `weightOfMetalArticlesNotRecyclable` must be **EMPTY**.
  - `txnDateTime` format = `MM/DD/YYYY hh:mm:ss AM` (12-hour local), NOT ISO.
  - `numberOfBulkContainers` must be POPULATED (empty tag = error 118). Photo count must equal declared container count, capped at 5.
- **Ohio's schema has TYPOS that are REQUIRED. Never "fix" these spellings:**
  - `bulkContainerPhoptos`
  - `licensePlateNumner`
  - `recycMaterilasNotSpecialPurchaseArticles`
- **Supporting files:** `src/lib/ohioMapping.ts` (PMR material codes → Ohio's 24 categories, code-based not name-based), `src/data/ohioErrorCodes.ts` (validation, error codes 104–129, critical/warning severity).
- **PENDING/VERIFY:** `src/lib/ohioSchemaLock.ts` was planned as a self-test blocking XML download if the generated file deviates from the accepted format. It may not have landed — confirm whether it exists; if not, rebuilding it is high-value.

### 1c. Compliance capture is mandatory at transaction time
- Hard blocks in BOTH ticket flows (Quick Ticket + full Buy Ticket): ID image + seller photo + DPS "Do Not Buy" (DNB) check must be present before completing.
- Photos carry timestamp burn-in (mm/dd/yyyy hh:mm AM, bottom-right) per Ohio Admin Code 4501:5-3-03.
- Placeholder/1x1 base64 images are detected and rejected (was silently passing before).
- Two-stage submission: status `submitted` → manual portal check → `verified`. "Green" on the dashboard means Ohio-confirmed, not just transmitted.
- **Daily Ohio report is due by 12:00 NOON the next day.**
- **DNB list** refreshed quarterly from services.dps.ohio.gov (primary) + Cincinnati PD list (secondary).
- **Policy:** PMR does NOT accept special-purchase articles (kegs, utility wire, guard rails, cemetery items, grocery carts) or railroad material — this deliberately sidesteps check-payment/2-day-hold and 30-day tag-hold requirements. Keep it that way unless the owner changes the policy.

---

## 2. CRITICAL — Architecture facts (don't accidentally undo)

- **This is a FULL-STACK app.** The `dev` script in `package.json` MUST remain `"tsx server.ts"`. Do NOT revert to a pure client-side Vite setup without migrating the Express proxy logic. Server runs on `http://localhost:3000`.
- **Cash model:** ONE cash drawer, at Tiffany's pay window. Two scale stations write tickets (cashier role, no drawer access); Tiffany/owner pay out against printed tickets (manager role). Ticket completed = cash paid, same minute, **cash only**. The drawer is NOT tied to any station. The app's existing assumption matches this reality — no cash-flow rearchitecture needed.
- **Firestore is the shared real-time layer** across the (max 3) machines. Do not propose moving data local/on-prem — multi-station sync + offline cache depend on Firestore. (This was explicitly evaluated and rejected.)
- **Offline hardening exists:** `persistentLocalCache`, print-BEFORE-network save sequence, PWA service worker, online/offline indicator. NOTE: uses `persistentSingleTabManager` → **one app tab per machine** (two separate machines fine; two tabs on one machine breaks cache).
- **Deploy target:** Firebase Hosting. **A real `firebase.json` does NOT yet exist** — deploy config is currently AI Studio's `firebase-applet-config.json` + `firebase-blueprint.json`. Creating a proper `firebase.json` for Firebase CLI deploys is a required setup step.

---

## 3. Google Sheets Sync Architecture (existing, keep working)

Multi-layered price sync from Google Sheets, built to overcome CORS + flexible user formatting.
- **Full-Stack Proxy:** `server.ts` — Express proxy at `/api/proxy-sheet` fetches Sheets data server-side via `axios` (bypasses CORS, standard User-Agent avoids bot-detection). **`axios` must remain in `package.json`.**
- **Smart Column Discovery (`ManagePrices.tsx`):** scans first 20 rows for header row (keywords "Code"/"Price"); data-driven fallback matches known material codes (e.g. "CU-1") to find the Code column; "Seeding Mode" toggle creates NEW materials + pulls Name/Category/Unit; `findColumn` fuzzy matching with keyword aliases; `Papa.parse` with `delimiter: ""` for auto-detect.
- **Debug Data View:** appears on sync failure — preserve it for support.
- Public price calculator mirrors the sheet: https://joaquin03-creator.github.io/PMR_ScrapCal/ (repo `PMR_ScrapCal`).

---

## 4. Security Rules conventions

- Pricing snapshots: managers create, cashiers view. Material price updates: managers only.
- Use `hasRequiredFields` / `isValidSnapshot` helpers in `firestore.rules`.
- `afterHoursNotes`: read = staff; create/update = `canManageCash()` + `isValidAfterHoursNote`; delete = `canDeleteData()`.
- **KNOWN GAP (V2.1):** several manager-only financial gates (provisional close, move transaction, retroactive sessions, reopen) are currently **UI-enforced only** — they must be moved to rules-level enforcement.

---

## 5. What's DONE (verified) — don't rebuild these

- **Ohio XML compliance** — live-accepted, format cracked, validation engine, code-based mapping, hard blocks, timestamp burn-in, two-stage verification, Compliance Data Repair utility in Settings.
- **Quick Ticket overhaul** — `QuickTicketModal.tsx` + `QuickTicketContext.tsx`, single instance in `Layout.tsx`, accessible everywhere. 4-step flow: Materials → Customer → Verify → Sign & Pay. Code-priority material search, careful Tab order, touchscreen debounce fixes, repeat-customer pre-load, itemized breakdown + ORC 4737.04 affirmation, draft auto-save.
- **Cash reconciliation** — full lock (§1a), historical-day viewing, provisional/carry-forward, move-transaction-between-days, ledger story view, after-hours detection (`src/lib/afterHoursDetection.ts`), QuotaExceededError crash fix (`safeStorage.ts`).
- **Inventory** — Physical Count Mode, Variance Dashboard, Quick Conversion drawer, invoice shortfall resolution (Option A/B), Material Duplicate Manager (`src/utils/materialDuplicates.ts`).
- **Dashboard** — compact header, four arc gauges (manager-only: Material Spend / Customers Today / Expected Profit / Margin %), cashiers see no financials, floating compliance notification stack.
- **Offline hardening, 19 contextual hints, Report-a-Problem tool** (`problemReports` collection + manager resolution list in Settings), customer phone export.

---

## 6. Open fix list / backlog (triage here)

Feedback funnel: bugs → in-app "Report a Problem" button (auto-captures diagnostics); suggestions → owner. Triaged into this list.

- [ ] **Coin column subtotal overlap** — in Cash Drawer denomination count, the "Coins & Change" per-denomination subtotals render overlapping the coin labels (looks like the paper-bills subtotals bleeding into the coins column). **Display/CSS only — the Calculated Closing Total math is correct.** Fix layout, do NOT touch subtotal calculation.
- [ ] **Audit-log display too verbose** — live-edit adjustment entries render the full before/after JSON blob (two big walls). Collapse to a one-line summary per entry with an expander for full detail. **Keep the full diff STORED (it's the audit trail) — only change the display.**
- [x] **Verify/rebuild `ohioSchemaLock.ts`** (see §1b). — Built 2026-09-15: `src/lib/ohioSchemaLock.ts` now exists with a blocking self-test wired into `handleDownloadXml` in Reports.tsx (never blocks a ticket — only the manager's XML generate/download step), plus a non-blocking per-ticket readiness check surfaced on the Dashboard's compliance stack, and a drawer-close handoff to auto-generate/validate that day's report.
- [x] **Create real `firebase.json`** for CLI deploys (see §2). — Built 2026-09-15: `firebase.json` + `.firebaserc` + `Dockerfile` added. Deploy target is Cloud Run (service `pmr-app`) behind a Firebase Hosting rewrite (`**` → Cloud Run), since `server.ts` is one Express process serving both the API and the built frontend. Run `npm run deploy` after one-time `gcloud`/`firebase` CLI login — see RECOVERY.md §6 for the full runbook. Not yet run against real production (needs the owner's login).
- [ ] **Clean up root clutter** — dead AI Studio scaffolding safe to delete: `patch.cjs`, `patch2.cjs`, `patch3.cjs`, `patch_cashdrawer.cjs`, `patch_cashdrawer2.cjs`, `patch_modal.cjs`, `patch_onblur.cjs`, `patch_tsconfig.cjs`, `patch_utils.cjs`, `fix-imports.cjs`, `fix2.cjs`–`fix5.cjs`. (Good zero-risk warm-up task.)

### Planned features (not yet built)
- [ ] **Owner's mobile dashboard** — read-only, phone-first summary for Tiffany (customer count, total spent, ticket count, drawer status, margin). Same login/auth, its own clean route, **strictly read-only** (no cash/ticket editing from phone). Reuses existing dashboard calcs + role gates.
- [ ] **Reolink NVR camera integration** — pull customer/load/vehicle snapshots. NVR has 10 cameras but only **4 max** feed the app; rest are surveillance. Pattern: app stays cloud-hosted, a thin local bridge (small always-on N100 mini-PC on shop LAN) fetches snapshots via Reolink HTTP endpoint (`/cgi-bin/api.cgi?cmd=Snap&channel=0`); credentials live on the bridge, never client-side. RTSP is not browser-compatible. NOT required for opening — webcam capture works and is compliant.

---

## 7. V2.1 "Hardened" sprint (post-opening security pass)

- **Secrets:** remove hardcoded Ohio DPS password fallback from `SettingsContext.tsx`; remove plaintext `cachedPassword` from Firestore user docs + localStorage key `pm_force_manager_password`; the `SCRIPT_AUTH_PASSWORD` in env/`RECOVERY.md` is also plaintext — address. Rotate DPS portal password after.
- **Backups:** scheduled Firestore exports, 1-yr retention (Ohio requirement), documented + drilled restore procedure.
- **Access:** MFA on Google/Firebase, GitHub, Ohio DPS, Squarespace; one login per human; move UI-only financial gates to Firestore rules (see §4).
- **Change control:** pre-publish checklist, git tag per publish (`v2.1-YYYYMMDD`), monthly Data Repair scan + audit review.
- Stale-build risk across machines: add a service-worker "new version available — reload" banner. Add an error boundary with "use the paper ticket and call Joaquin" fallback.

---

## 8. Working conventions (how the owner likes to work)

- Direct, practical, clean over over-engineered. Actionable and structured. Iterative with clear checkpoints before proceeding.
- **For anything near money or compliance:** show the actual diff, confirm the locks are untouched, verify rather than assert. The whole reason this project moved to Claude Code was to replace "trust the generator's self-report" with "read the real code and prove it."
- When you finish a fix list item, check it off in §6 and add a one-line note. Keep this file current — it's how continuity survives across sessions.

---

## 9. Local dev quick reference

```bash
# Install deps (already done once)
npm install

# Run locally (full-stack — do not change to plain vite)
npm run dev          # → http://localhost:3000
```
- Env vars documented in `.env.example`. Firebase config currently via `firebase-applet-config.json` (a real `firebase.json` is still to be created).
- See `RECOVERY.md` for disaster-recovery / restore detail.
