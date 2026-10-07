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
- **Offline hardening exists:** `persistentLocalCache`, print-BEFORE-network save sequence, PWA service worker, online/offline indicator. Since 2026-10-07 the cache uses `persistentMultipleTabManager` (1 GB cap): several tabs/windows on one machine share the cache safely. **Do not switch back to the single-tab manager** — in that mode a tab that lost the lock to another tab on the same machine kept accepting writes and never sent them. The lock is per browser per machine; separate laptops never contend. Completed Quick Tickets also go through `src/lib/ticketOutbox.ts` (see §6), and `useSaveWatchdog` shows a red banner when a tab's writes go unconfirmed for over a minute.
- **Deploy target:** Firebase Hosting. **A real `firebase.json` does NOT yet exist** — deploy config is currently AI Studio's `firebase-applet-config.json` + `firebase-blueprint.json`. Creating a proper `firebase.json` for Firebase CLI deploys is a required setup step.
- **Three deployments exist — know which is which. PRODUCTION IS (c) as of 2026-10-06** (owner: "no more AI Studio link"). A deploy from this repo now goes straight to what staff use — treat `npm run deploy` as a production release.
  - **(a) AI Studio dev-preview link (RETIRED from daily use 2026-10-06):** `https://ais-dev-fiapso7rtkpidrzgaot6nx-163709909409.us-east1.run.app/` — runs inside a Google-managed GCP project the owner does NOT control; no backup, no custom domain. Still reachable and runs OLD code against the SAME Firestore database (it lacks the 2026-10-05/06 cash-drawer write fixes) — nobody should use it.
  - **(b) `preferred-metals-recycling` (older, unused Cloud Run service):** lives in the owner's own project (`gen-lang-client-0857392953`, us-west1), deployed historically via AI Studio's "Publish" button. Not part of the daily workflow.
  - **(c) New owned deployment (this repo's deploy path):** Cloud Run service `pmr-app` (us-central1) behind Firebase Hosting at `https://gen-lang-client-0857392953.web.app`, built via `Dockerfile` + `firebase.json` + `npm run deploy` (see RECOVERY.md §6). Verified live 2026-09-17. **In daily use since 2026-10-06.** `GEMINI_API_KEY` is set on the service via Secret Manager.

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

- [ ] **[SECURITY - HIGH] Reolink camera credentials are client-side** — `reolinkUsername`/`reolinkPassword` are stored in client settings and passed in a plaintext URL query string in `CameraCapture.tsx` (`/cgi-bin/api.cgi?cmd=Snap&channel=...&user=...&password=...`). Must be moved off the client onto the local-bridge pattern already described under "Reolink NVR camera integration" below before this feature is used in production. **Do not use the camera integration for real transactions until this is fixed.**
- [x] **Production cutover** — Done 2026-10-06 by owner decision: staff now use the owned deployment (`https://gen-lang-client-0857392953.web.app`), not the AI Studio link (see §2). Follow-ups still open: (1) make sure every station's bookmark/installed PWA points at the owned URL — the old link still works and runs old code against the same data; (2) `firestore.rules` / `storage.rules` have uncommitted local changes that have NOT been deployed by the 2026-10-06 hosting-only deploys — confirm what is live before the next full `npm run deploy`; (3) no custom domain yet; (4) backups (§7) matter more now.
- [ ] **Coin column subtotal overlap** — in Cash Drawer denomination count, the "Coins & Change" per-denomination subtotals render overlapping the coin labels (looks like the paper-bills subtotals bleeding into the coins column). **Display/CSS only — the Calculated Closing Total math is correct.** Fix layout, do NOT touch subtotal calculation.
- [ ] **Audit-log display too verbose** — live-edit adjustment entries render the full before/after JSON blob (two big walls). Collapse to a one-line summary per entry with an expander for full detail. **Keep the full diff STORED (it's the audit trail) — only change the display.**
- [x] **Verify/rebuild `ohioSchemaLock.ts`** (see §1b). — Built 2026-09-15: `src/lib/ohioSchemaLock.ts` now exists with a blocking self-test wired into `handleDownloadXml` in Reports.tsx (never blocks a ticket — only the manager's XML generate/download step), plus a non-blocking per-ticket readiness check surfaced on the Dashboard's compliance stack, and a drawer-close handoff to auto-generate/validate that day's report.
- [x] **Create real `firebase.json`** for CLI deploys (see §2). — Built 2026-09-15: `firebase.json` + `.firebaserc` + `Dockerfile` added. Deploy target is Cloud Run (service `pmr-app`) behind a Firebase Hosting rewrite (`**` → Cloud Run), since `server.ts` is one Express process serving both the API and the built frontend. Run `npm run deploy` after one-time `gcloud`/`firebase` CLI login — see RECOVERY.md §6 for the full runbook. Not yet run against real production (needs the owner's login).
- [x] **Inventory: perpetual-with-true-up model + Digital Material Inventory Sheet** — Built 2026-09-20. Decision: ticket-derived on-hand (`InventoryItem.currentWeight`) is a **book estimate only**, never shown as actual — processing/upgrading purchased material reclassifies weight between materials and destroys some (shrink), so ticket totals were never going to match what ships. **Load-out weigh-up (and full Count Mode) is the authoritative physical truth.** Reconciliation checkpoint = each load-out; a full Count-Mode pass is only *needed* as a backstop if a calendar month passes with no load.
  - **Flatbed Planner tab removed 2026-09-20** (never used in real operation — was built for a transport setup PMR no longer uses). The reconciliation trigger moved to **Invoices**: a "Reconcile Shipment" action appears on a `paid` invoice (Invoices page, invoice preview modal), scoped to that invoice's materials only. `Invoice` gained a `reconciledAt` field. The `loadPlans` collection/state and its handlers were left in place (unused, zero risk) rather than mass-deleted from an already-large file — full cleanup deletion is a separate future task if wanted.
  - `ProcessingShrinkAdjustment` (new `processingShrinkAdjustments` collection) books the per-material book-vs-physical gap in bulk, ONE append-only audit-logged entry per invoice (`update: if false` in rules) — not per-conversion. Keyed by `invoiceId`/`invoiceNumber`.
  - Variance Dashboard (Inventory → Real-time Stock tab) now headlines **Residual Variance** (what's left unexplained since each material's *last load-out reconciliation*, not last physical count) above the pre-existing raw book-vs-expected table, which stays as detail.
  - Shipment economics panel (shown on a reconciled invoice): upgrade gain (lbs moved to higher-value materials via logged conversions), shrink % of purchased weight, unexplained variance (= that invoice's booked adjustment), and realized margin at cost — plus at sell price only when every involved material has a `salePrice` set. Margin is per-load-cycle (owner's call), not cumulative.
  - New `materialInventorySheets` collection: a digital, dated-snapshot version of the paper Material Inventory Sheet (Inventory → new "Material Sheet" tab) — Box #/Material/Gross/Tare/Net(auto)/Date/Remarks per row, boxes editable after entry for top-offs, **never overwrites a prior sheet** ("Start New Sheet" creates a new dated doc, carrying forward current rows as a starting point). Feeds a load-readiness forecast: net lbs boxed vs. the 36,000 lb full-load target, projected date to the 27,000 lb (75%) buyer-lock trigger from intake velocity (lbs/week, averaged over recent sheet-to-sheet deltas), and a 30-day fulfillment countdown once "Lock Order" is clicked.
  - Material entry on the sheet reuses Quick Ticket's exact code-priority matching algorithm via a new `src/lib/materialSearch.ts` (extracted verbatim, byte-identical) and a new generic `<MaterialAutocompleteInput>` component — **QuickTicketModal.tsx itself was deliberately left untouched**, not refactored, to avoid any risk to that already-proven, heavily-used flow.
  - Core calculations (`src/lib/loadReadiness.ts`, `src/lib/loadEconomics.ts`) are pure functions, verified against synthetic data before wiring into any UI (velocity/projection math, upgrade/shrink/margin formulas, period-boundary filtering) — not yet click-tested in a live browser.
  - Reconcile Shipment now also accepts a photo of the buyer's receiving slip (uploaded to Storage `reconciliation-slips/`, same `uploadBytes`/`getDownloadURL` pattern as customer ID photos) plus free-text notes on how the material was received (deductions/contamination/downgrades) — both stored on the `ProcessingShrinkAdjustment` and surfaced back on the invoice's Shipment Economics panel. Owner testing this against a real commercial shred shipment.
  - Material Sheet is the 2nd tab (was buried near the end); tab bar wraps to two rows (`flex-wrap` + fixing a `shrink-0` on the wrapping div that was letting the whole header overflow instead of wrapping) instead of requiring horizontal scroll.
  - Explicitly untouched per guardrails: `cashLogicLock.ts`, cash drawer flow, `ohioMapping.ts`, `ohioSchemaLock.ts`, XML generation, Quick Ticket/purchase-ticket mechanics.
- [x] **Provisional close: one-click, and never stored as a count** — Built 2026-10-05 (tsc clean + helper verified on synthetic records; **not yet click-tested in a live browser**). A provisional close no longer writes `actualCash`/`overShort` (it clears them); the assumed figure lives only in `provisionalAssumedCash`. New `src/lib/provisionalCash.ts` (`isProvisionalSession` / `getClosingBasis` / `getCountedOverShort`) is the status-keyed READ helper — **any new screen/export that shows a session's closing cash or over/short must go through it**, never read `actualCash`/`overShort` raw. Keyed off `status`, so provisional records closed before this date (which still store `actualCash = assumed, overShort = 0`) display correctly with no data rewrite (owner's decision: display-only, no cleanup). Manager-only "Provisional Close (No Count)" button added beside "Finalize Reconciliation" (fresh ticket/transaction fetch, confirm dialog). "Save Physical Count" is blocked on provisional sessions and routes to Finalize. Move-transaction recompute skips over/short for provisional. `cashLogicLock.ts`, `handleCloseDay`, the Finalize flow, rules, and Ohio files untouched.
  - Finalize audit payload: `before.actualCash` is now `?? null` (owner-approved 2026-10-05, the only edit inside the Finalize flow). Without it, a new-style provisional record's `undefined` actualCash made Firestore reject the audit write, which `logAuditEvent` swallows — the finalize succeeded but its audit entry was silently dropped. **General gotcha:** `logAuditEvent` never throws, so any `undefined` inside a `changes` payload loses the entry without an error; use `?? null`.
- [x] **Cash Drawer: opening or correcting a past day never forces a close** — Built 2026-10-06 (tsc/lint/build clean; **not yet click-tested in a live browser**). The Catch-Up modal no longer blocks opening today (both guards removed); the Open Ledger form shows a non-blocking notice naming earlier still-open days, with an optional "Review Open Days" link to Catch-Up. A past date with no session shows a neutral "No Cash Session" panel instead of the Start card (which always opens *today*). **"Re-open for changes" now KEEPS the physical count** (only status/closedAt/closedBy change; a provisional day's non-count figures are still cleared) — it used to delete actual/over-short/denominations, after which auto-save wrote actual 0. Start Day prefill ignores an open prior day whose count is all zeros.
  - **Two write defects fixed in the same change (both had corrupted live records):** (1) count auto-save used to write the whole field set (opening/expected/actual/over-short) from a station's local state on any load — a second station silently reverted an opening correction on 2026-10-05. It now writes only fields edited on that station (compared against a per-session server baseline, `serverBaselineRef`), and `expectedCash`/`overShort` always move together. (2) the background `expectedCash` writer and the manual sheet save now wait for `sessionTotalsReady` (the on-screen tickets/transactions belong to the selected session) — right after switching days they held the previous day's totals, which is how 2026-09-26 and 2026-10-02 got a wrong stored `expectedCash`. The writer also updates `overShort` with the locked formula when it changes expected on a counted session.
  - **Still wrong in the data (not repaired by code):** stored `expectedCash` on 2026-09-26 and 2026-10-02 (self-test violations; should self-correct the next time each day is opened and its data loads), 2026-10-03 actual is a 12,000 placeholder (owner confirmed ~13,308), 2026-10-05 opening 7,880 should be 8,883.50. Open money question: ~$7,968 unrecorded cash-in before the Saturday 10/03 morning count (Geno tickets $10,888.75 were paid cash at ~2 AM 10/03, before that count).
- [x] **Cash Drawer: selected historical day snaps back** — Fixed 2026-10-06 (tsc/lint/build clean; not yet click-tested). Cause: the `?date=` URL-param effect re-applied on every `cashSessions` snapshot and overrode whatever day was selected; the param was set by the Dashboard after-hours "Review" link and the gap/after-hours day buttons and almost never cleared. Now applied once per distinct value after history loads (`appliedDateParamRef` + `historyLoaded`), and "View Ledger", both "Back to Today" buttons and "View Today" clear it (and reset `selectedDate`). Leftover `[CASHDBG]` console logging removed.
- [x] **Ticket submit hang / lost ticket — safety copy + background save** — Built 2026-10-07 (tsc/lint/build clean, outbox storage unit-tested with fake-indexeddb; **the submit flow itself is NOT yet click-tested in a browser**). Symptom: "Submit & Print" and Cash Drawer "Resolve & Create Session" both spun forever, ticket never saved, refresh "fixed" it. Leading cause (measured, not observed in a browser): tickets embed 5 base64 photos (~200 KB each) and every `buyTicket/create` audit entry embedded a second full copy, so one screen's listeners pull 40–170 MB through a 40 MB cache; writes queue behind that in Firestore's single client queue. Worst on 2026-10-06 because the cutover URL is a new origin = empty cache on every station.
  - `src/lib/ticketOutbox.ts` (new): every completed Quick Ticket is first stored in its own IndexedDB database (`pmr-ticket-outbox`, localStorage fallback `pm_outbox_ticket_*` — deliberately NOT a prunable `pm_draft_` key), then sent. `QuickTicketModal.saveQuickTicket` now: safety copy → fire ticket write → print → release the screen; `finishTicket()` runs in the background (waits for server confirm, then customer update / inventory increments / audit / draft delete). `Layout.tsx` calls `replayTicketOutbox()` after login and on `online`: anything still in the outbox is checked against the server and re-sent with the SAME ticket id and ORIGINAL timestamp.
  - **No-double-count invariant — keep it:** follow-up writes are issued only AFTER the server confirms the ticket, and each group is flagged `issued` in the outbox entry BEFORE it is sent; replay never re-sends an issued group and first waits for `waitForPendingWrites`.
  - A server-REJECTED ticket now shows a red "TICKET NOT SAVED" toast (it used to be reported as "Saved on this device — will sync"). New ticket-create audit entries store the ticket without embedded photos (`stripPhotosForAudit`); the ticket record itself keeps every photo. Firestore cache cap raised 40 MB → 1 GB (`src/firebase.ts`).
  - **What the data later showed (2026-10-07):** the three "lost" tickets of 2026-10-06 (BUY-20261006-142215 / -145711 / -153345, $486.49 total) were never lost — one tab stored them and 24 duplicate drafts locally from ~2:15 PM and sent nothing until 10:42 PM, when they arrived with their original timestamps. Fixed/deployed in `9e09f61` (Cloud Run rev `pmr-app-00005-qf7`): multi-tab cache manager; drafts get their id locally before saving (all four ticket screens — the old `await addDoc` then `setActiveDraftId` created a new draft on every autosave while unconfirmed); `useSaveWatchdog` banner; the Dashboard "laptop closure or battery loss was detected" text removed (nothing ever detected that — it showed whenever any draft existed). Data repaired with `scripts/backfill_2026-10-06_stuck_tab.py` (dry-run by default, refuses to run twice): 24 burst drafts deleted; for each of the three tickets one `auditLogs/backfill_<ticketId>_create` entry plus the missing inventory increments, one atomic commit per ticket. Exact reason that tab could not send is NOT proven (same-machine tab lock loss vs. cold-cache overload on the new URL).
  - **Not done:** `BuyTicketModal.tsx` (full Buy Ticket) still uses the old await-everything flow — port it the same way. "Resolve & Create Session" has no timeout. **Real fix still owed:** move photos out of ticket documents (Storage or a sibling media doc) so ticket lists are a few KB each — touches Ohio XML photo fields and needs a migration of existing tickets.
  - **Catalytic converter rule — FIXED 2026-10-07** (`src/lib/catalyticUtils.ts`): matches material code 33 (the live "Catalytic Convertor"; 38 was the original, wrong code) and the name as a safety net. The daily lookup reads today's tickets only (it used to read the whole collection) with a 10 s bound. **Owner policy: missing details never block a ticket.** Missing business name / seller ID number are FLAGS, derived from the ticket itself by `getCatalyticFollowUp()` (nothing extra stored, so the 18 older converter tickets show too): amber notice in Quick Ticket (which now has a Business Name field on the Customer step), a "Follow-up" badge and a manager add-later form in Ticket History (audit-logged, fills blank customer-profile fields), and a Dashboard reminder card. The one-per-person-per-day limit is ALSO a flag, not a block (owner decision, same day): the operator gets a notice, and `getCatalyticDailyLimitTicketIds()` marks the ticket "Daily limit" in Ticket History and on a Dashboard card. Nothing in the catalytic check blocks a ticket any more (`allowed` is always true). The legal citations in the messages come from the original code and were not independently verified.
  - **Found on the way, NOT fixed:** (2) `/api/check-ohio-db` in `server.ts` is a stub that never contacts the state (always "cleared"; the real check is the local Do-Not-Buy list); (3) one station's clock/timezone is an hour behind (ticket IDs stamped an hour early).
- [x] **Historical Ledgers rebuilt + ticket search by material / search-on-Enter** — Built and deployed 2026-10-07 (`b4f166f`, `350ca2e`; Cloud Run rev `pmr-app-00007-hzg`). tsc/build clean, ledger row logic verified against live 9/25–10/05 figures; **neither is click-tested in a browser.**
  - **Ledger:** `src/lib/ledgerRows.ts` (pure, no new math — uses the locked `calculateExpectedCash`/`calculateOverShort`/`isCashPayoutTicket`) + `src/components/CashLedgerTable.tsx`, wired in `CashDrawer.tsx` under History → Historical Ledgers. Columns: Date · Starting Count · Money In · Money Out · Final Count · Over/Short. Money In = `cashTransactions` type `inflow` by session; Money Out = `cashTransactions` type `expense` + that day's drawer-paid `buyTickets`. Over/Short is COMPUTED per row; when the stored `overShort` on the record differs it shows "record says …" (never hidden, never corrected). Quiet amber note under Starting Count when it ≠ prior day's Final Count by > 1¢. Provisional = "assumed — not counted" + pending. **Because tickets embed photos, only the 14 days already loaded on the screen are complete at once**; earlier rows fill in via "Load Money Out for earlier days" (14-day blocks). "Show earlier days" raises the session limit past 30. The old table's per-row badges/breakdown buttons/Finalize button are gone (Finalize lives in the day view and the Match Tracker tab); Open and Close Day remain.
  - **Search:** neither ticket search looked at materials (line items store only `materialId`). Ticket History and the top search bar now match material name (contains) or code (exact) via the materials list. Ticket History search runs on Enter / Search button with a "Searching…" state, match count, Clear, and an explicit "Nothing matched …" message. Customer Search tab: blank weight = any amount.
  - **Housekeeping found:** ~20 project files are owned by `root` and read-only to the `joaquin` account (earlier root session). Fix with `sudo chown -R joaquin:joaquin /home/joaquin/PMR-app`. Hosting serves `index.html` with `max-age=3600`, so stations can lag a deploy by up to an hour without a hard refresh.
- [x] **Station hygiene: Eastern time, Quick Ticket starts fresh, deploys reach stations, force re-login** — Built 2026-10-07, committed and pushed; **NOT deployed (built during work hours — deploy after close)**. tsc/build clean, time-zone logic tested under four machine zones; not click-tested.
  - **Operating rule from the owner (2026-10-07):** top priority is efficient, uninterrupted operation during work hours. Changes must only make life easier — no new dependencies or roadblocks. **Never deploy or force a re-login while the yard is open**; a deploy can reload a station mid-ticket.
  - Ticket ids (`generateTicketId`) and photo timestamp burn-in (`CameraCapture.tsx`) now use US Eastern time via `getEasternDateParts()` in `src/lib/utils.ts`, whatever the computer's zone is (one station is set to Central and stamped ids an hour early). `Layout.tsx` shows a dismissible amber notice on a computer whose clock zone is not Eastern. The ~22 `toLocaleDateString('en-CA')` "today" calculations still use the computer's zone — only matters near midnight; the real fix is setting Windows to Eastern.
  - Quick Ticket: closing the modal after a completed ticket resets it, and the autosave draft is deleted immediately with the ticket write (`fireTicketWrites`), so the next open starts a new ticket instead of showing or offering to resume the finished one.
  - `firebase.json`: `Cache-Control: no-cache` on `/`, `*.html`, `sw.js` and the manifest, so a deploy is picked up on the next load instead of up to an hour later.
  - `scripts/force_relogin.py` (dry-run by default): sets `status: 'logout'` on live `userSessions` docs; every open tab, old build or new, signs out and reloads to login, which puts every station on the current build. Concurrent sessions were NOT the cause of lag (only 2–4 live at once); mixed builds and photo-heavy ticket documents were.
- [ ] **Clean up root clutter** — dead AI Studio scaffolding safe to delete: `patch.cjs`, `patch2.cjs`, `patch3.cjs`, `patch_cashdrawer.cjs`, `patch_cashdrawer2.cjs`, `patch_modal.cjs`, `patch_onblur.cjs`, `patch_tsconfig.cjs`, `patch_utils.cjs`, `fix-imports.cjs`, `fix2.cjs`–`fix5.cjs`. (Good zero-risk warm-up task.)

### Planned features (not yet built)
- [x] **Owner's mobile dashboard** — Built 2026-09-18: `/today` route (`src/pages/MobileDashboard.tsx`), standalone outside `Layout.tsx` (no sidebar/nav chrome) so it can't affect the desktop dashboard UI. Shows today's Material Spend and Customers Today vs. the same day last week, reusing Dashboard.tsx's existing comparison logic. Manager-only, same auth session, scoped to an 8-day ticket query instead of Dashboard's 30-day pull.
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
- **Crash-safety is mandatory on any multi-field data-entry form, sheet, or count session** — anything that takes more than a few seconds to fill out before there's a submit/save action. A form that only persists on final submit loses everything if the tab dies first (crash, accidental swipe on a tablet, OS backgrounding the browser). This actually happened 2026-09-21: ~90 min of Material Inventory Sheet box weigh-ups lost when a tablet accidentally exited the browser, because that form only saved on an explicit "Save Sheet" click.
  - **Use the existing pattern, don't invent a new one.** Draft persistence already exists in this codebase in two layers: (1) `src/lib/safeStorage.ts` — quota-safe localStorage wrapper (`safeSetItem`/`safeGetItem`/`safeRemoveItem`) with auto-pruning, used directly by Cash Drawer (`cash_*_draft_*` keys) and Invoices' new-invoice form (`pm_draft_invoice`, `pm_editing_invoice`, silently restored on mount); (2) `src/hooks/useLocalDraftBackup.ts` — a reusable hook wrapping that convention (debounced localStorage mirror + `beforeunload` warning + `readDraft`/`clearDraft` helpers), added 2026-09-21 and used by `MaterialInventorySheetTab.tsx` and Physical Count Mode (`Inventory.tsx`).
  - **Key naming:** always prefix new draft keys with `pm_draft_` (e.g. `pm_draft_myform_<id>`) so they're covered by `clearAllPrunableStorage()`'s emergency quota purge. Don't use a different prefix scheme.
  - **Where a form has a natural backing Firestore document already** (like the Material Inventory Sheet), also add a short-debounced autosave to that document — see `persistRows`/`AUTOSAVE_DEBOUNCE_MS` in `MaterialInventorySheetTab.tsx` for the pattern (manual save button stays as an explicit, user-visible action; autosave is the safety net, not a replacement).
  - **Recovery UX:** on load, compare a local draft's timestamp to the last-synced/clean baseline; if the draft is newer, restore it and tell the user (banner/notification), don't silently discard it. See the "Unsaved Physical Count Found" banner in `Inventory.tsx` for a resume/discard pattern when there's no natural document to compare against.
  - Applies to *new* forms going forward by default — don't wait to be asked. Retrofitting other existing single-shot forms (Trip Ticket, Buy/Quick Ticket, Reconcile Shipment modal) is lower priority since those are normally filled in under a couple minutes, but flag it if you notice one that routinely takes longer.

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
