# Recovery & Operations Guide — Preferred Metals & Recycling

This document details application architecture, environment configuration, local development setup, disaster recovery procedures, and database persistence guidelines for **Preferred Metals & Recycling**.

---

## 1. Application Overview & Core Purpose

**Preferred Metals & Recycling** is a full-stack, enterprise scale house scrap yard management application built with **React**, **TypeScript**, **Tailwind CSS**, **Express**, and **Firebase (Firestore & Authentication)**.

### Key Capabilities
- **Buy Ticket Scale Operations**: Rapid cashier & robust scale tickets with customer identification, live digital scale integration, photo capture, signature capture, and state compliance reporting.
- **Inventory & Multi-Destination Material Conversions**: Real-time material inventory tracking, multi-destination material conversion/processing (e.g., converting 500 lbs Dirty Radiators into 350 lbs Clean Radiators + 100 lbs Radiator Ends), and inventory adjustments with automatic yield calculation and deficit safety checks.
- **Trip Tickets & Invoicing**: Outbound freight tracking, BOL generation, and customer invoicing with automated inventory deductions.
- **Cash Drawer Management**: Shift management, opening/closing cash drawer balances, inflow/expense logging, and cash overage/shortage tracking.
- **Pricing Management**: Live material price updates and automated Google Sheets sync proxy.
- **State Compliance Reporting**: Daily compliance transaction filtering and XML export generation.

---

## 2. Environment Variables & Configuration

All environment variables required by the system are documented in `.env.example`.

| Variable Name | Description & Purpose | Source / How to Obtain |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Required for Gemini AI API calls (smart report summaries, material categorization). | Injected automatically by AI Studio at runtime, or generate in [Google AI Studio](https://aistudio.google.com/). |
| `APP_URL` | Base URL where the Cloud Run / applet server is hosted. Used for self-referential links & callbacks. | Automatically assigned by Cloud Run or set to `http://localhost:3000` for local testing. |
| `SCRIPT_AUTH_EMAIL` | Optional account email for running administrative CLI maintenance scripts. | Designated manager email in Firebase Auth. |
| `SCRIPT_AUTH_PASSWORD` | Optional password for running administrative CLI maintenance scripts. | Designated manager password in Firebase Auth. |

---

## 3. Step-by-Step Local Setup Instructions

Follow these exact commands to set up and run the application from scratch on a new developer workstation:

```bash
# Step 1: Clone the repository
git clone <repository-url>
cd <repository-folder>

# Step 2: Install dependencies
npm install

# Step 3: Create environment file from template
cp .env.example .env

# Step 4: Ensure Firebase config file exists
# Verify firebase-applet-config.json is present in the project root.
# (If setting up a new Firebase project, see Section 4 below).

# Step 5: Start the dev server
npm run dev
```

The server will start on `http://localhost:3000` using `tsx server.ts`.

---

## 4. Connecting to Live Firebase vs. Restoring to a New Project

The application connects to Firebase via `firebase-applet-config.json` at the root directory.

### Connecting to the Live Firebase Project
To connect to the existing live project:
1. Ensure `firebase-applet-config.json` contains the valid credentials (`projectId`, `apiKey`, `authDomain`, `firestoreDatabaseId`, etc.).
2. The custom database ID used by this app is configured via `firestoreDatabaseId` in `firebase-applet-config.json`.

### Restoring to a New or Restored Firebase Project
If the original Firebase project is lost or you are deploying to a fresh project:
1. **Create Firebase Project**: Create a new Firebase project in the [Firebase Console](https://console.firebase.google.com/).
2. **Provision Firestore Database**:
   - Create a Firestore database instance with the designated Database ID (or update `firestoreDatabaseId` in `firebase-applet-config.json` to match).
3. **Update Configuration File**: Update `firebase-applet-config.json` with the new project settings:
   ```json
   {
     "projectId": "your-new-project-id",
     "appId": "your-app-id",
     "apiKey": "your-api-key",
     "authDomain": "your-new-project-id.firebaseapp.com",
     "messagingSenderId": "your-sender-id",
     "firestoreDatabaseId": "ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
   }
   ```
4. **Deploy Security Rules**:
   - Deploy `firestore.rules` using the Firebase CLI:
     ```bash
     firebase deploy --only firestore:rules
     ```
   - Deploy `storage.rules` using the Firebase CLI:
     ```bash
     firebase deploy --only storage
     ```
5. **Seed Essential Roles**:
   - Register the admin account (`tiffany@preferredmetalsrecycling.com`, `info@preferredmetalsrecycling.com`, or `joaquinrodriguez3333@gmail.com`) in Firebase Authentication and set its Firestore user role document under `users/{uid}` with `role: "manager"`.

---

## 5. Database Backup & Point-In-Time Recovery (PITR)

> [!IMPORTANT]
> **Firestore data is NOT stored in this Git repository.**
> Data persistence and disaster recovery for transactional records, customer logs, and tickets are managed directly by Google Cloud Firestore.

- **Point-in-Time Recovery (PITR)**: Enabled on the Firestore database instance, providing continuous backup with 7-day retention for instant sub-second rollback.
- **Scheduled Automated Exports**: Daily automated exports of all Firestore collections are written to a Google Cloud Storage bucket (`gs://<project-id>-firestore-backups/`).
- **Restoration**: Detailed recovery procedures for restoring Firestore snapshots from Cloud Storage can be found in the system administration cloud run playbooks.

---

## 6. Production Deployment (Cloud Run + Firebase Hosting)

Until 2026-09-15 this app was only ever deployed via AI Studio's own managed pipeline (it auto-builds and pushes to a Cloud Run service, injecting `APP_URL`/`GEMINI_API_KEY` for you — see `.env.example`). This section documents the equivalent deploy path using the standard Firebase/Google Cloud CLIs, for deploying independently of AI Studio.

**Architecture:** `server.ts` is one Express process that serves both the `/api/*` routes and the built frontend (`dist/`) — see its `NODE_ENV === 'production'` branch. It ships as a single container to **Cloud Run**. **Firebase Hosting** sits in front of it purely for TLS/custom-domain/CDN and rewrites all traffic (`source: "**"`) to that Cloud Run service — see `firebase.json`. Firestore/Storage security rules deploy through the same Firebase CLI call. None of this touches the AI Studio-managed service; `pmr-app` is a distinct Cloud Run service name, so the two deploy paths can't collide.

### One-time setup (per machine you deploy from)

```bash
# 1. Install & authenticate the Google Cloud CLI
#    https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project gen-lang-client-0857392953

# 2. Install & authenticate the Firebase CLI
npm install -g firebase-tools
firebase login
```

**Runtime secret:** `server.ts` requires `GEMINI_API_KEY` at runtime (AI/OCR endpoints). Cloud Run needs it set explicitly — AI Studio's auto-injection does not apply here. Recommended (Secret Manager, keeps the key out of shell history and deploy logs):

```bash
printf '%s' 'YOUR_GEMINI_KEY' | gcloud secrets create gemini-api-key --data-file=-
# then add this flag to the deploy:backend command in package.json (one-time):
#   --set-secrets=GEMINI_API_KEY=gemini-api-key:latest
```

Simpler but less secure alternative: append `--set-env-vars GEMINI_API_KEY=YOUR_GEMINI_KEY` to `deploy:backend` instead.

### Ongoing deploy

```bash
npm run deploy
```

This runs, in order:
1. `deploy:backend` — `gcloud run deploy pmr-app --source .` — builds the `Dockerfile` via Cloud Build and deploys/updates the Cloud Run service (creates it on first run; prints its own `*.run.app` URL, which you generally don't need to visit directly once Hosting is wired up).
2. `deploy:hosting` — `firebase deploy --only hosting,firestore:rules,storage` — publishes the Hosting rewrite config (pointing at the Cloud Run service above) plus the current `firestore.rules`/`storage.rules`.

Run them separately (`npm run deploy:backend`, `npm run deploy:hosting`) if you only need one half.

### Verify after deploying

- Open the Firebase Hosting URL (`https://gen-lang-client-0857392953.web.app` or your mapped custom domain) and confirm login works.
- Complete one real Quick Ticket end-to-end (a cheap smoke test that exercises Firestore, Storage, and the OCR/AI endpoints together).
- Check Cloud Run logs (`gcloud run services logs read pmr-app --region us-central1`) if anything looks wrong.
