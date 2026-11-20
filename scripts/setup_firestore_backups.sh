#!/usr/bin/env bash
# Nightly Firestore backup for PMR (AGENTS.md §7 "Backups").
#
#   bash scripts/setup_firestore_backups.sh            # CHECK ONLY: shows what exists, changes nothing
#   bash scripts/setup_firestore_backups.sh --apply    # creates whatever is missing (safe to re-run)
#
# What --apply sets up (all inside project gen-lang-client-0857392953):
#   1. Bucket gs://<project>-firestore-backups in the database's location, Nearline storage,
#      versioning off, lifecycle rule that deletes exports after 400 days (Ohio keeps records 1 year).
#   2. Service account pmr-backup@ with roles/datastore.importExportAdmin (export only, no data reads
#      in the app sense) and write access to that bucket.
#   3. Cloud Scheduler job "pmr-firestore-nightly-export": 11:30 PM America/New_York every day, calls the
#      Firestore exportDocuments API for the app's database (all collections) into
#      gs://<bucket>/YYYY-MM-DD... (Firestore names each export folder by timestamp).
#   4. Point-in-time recovery (7-day rollback) on the database, if it is not already on.
#
# Cost, roughly: one read per document per night (~10k docs = cents/month) plus Nearline storage for
# 400 days of exports (~0.4 GB/night today -> a few dollars/month at full retention).
#
# Needs: `gcloud auth login` as an owner of the project (same login the deploy and scripts/*.py use).
# Restore and drill steps: RECOVERY.md §5.
set -euo pipefail

PROJECT="gen-lang-client-0857392953"
DB="ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
BUCKET="${PROJECT}-firestore-backups"
SA_NAME="pmr-backup"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
JOB="pmr-firestore-nightly-export"
SCHED_REGION="us-central1"
SCHEDULE="30 23 * * *"
TZ_NAME="America/New_York"
RETENTION_DAYS=400

APPLY=0; [[ "${1:-}" == "--apply" ]] && APPLY=1
say()  { printf '%s\n' "$*"; }
ok()   { printf '  [ok]      %s\n' "$*"; }
miss() { printf '  [missing] %s\n' "$*"; }
run()  { if (( APPLY )); then printf '  [create]  %s\n' "$*"; "$@"; fi; }

gcloud config set project "$PROJECT" >/dev/null 2>&1
say "Project $PROJECT, database $DB"
(( APPLY )) && say "Mode: APPLY (creating anything missing)" || say "Mode: CHECK ONLY (re-run with --apply to create)"

# --- database location + PITR -------------------------------------------------------------
LOC="$(gcloud firestore databases describe --database="$DB" --format='value(locationId)')"
PITR="$(gcloud firestore databases describe --database="$DB" --format='value(pointInTimeRecoveryEnablement)')"
say "Database location: $LOC"
case "$LOC" in nam5) BUCKET_LOC="US" ;; eur3) BUCKET_LOC="EU" ;; *) BUCKET_LOC="$LOC" ;; esac

say "1. Point-in-time recovery"
if [[ "$PITR" == "POINT_IN_TIME_RECOVERY_ENABLED" ]]; then ok "PITR enabled (7-day rollback)"
else miss "PITR is $PITR"; run gcloud firestore databases update --database="$DB" --enable-pitr; fi

# --- APIs ---------------------------------------------------------------------------------
say "2. APIs"
for api in cloudscheduler.googleapis.com firestore.googleapis.com storage.googleapis.com; do
  if gcloud services list --enabled --filter="config.name=$api" --format='value(config.name)' | grep -q "$api"; then ok "$api"
  else miss "$api"; run gcloud services enable "$api"; fi
done

# --- bucket -------------------------------------------------------------------------------
say "3. Backup bucket gs://$BUCKET ($BUCKET_LOC)"
if gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then ok "bucket exists"
else
  miss "bucket"
  run gcloud storage buckets create "gs://$BUCKET" --location="$BUCKET_LOC" --default-storage-class=NEARLINE \
      --uniform-bucket-level-access --public-access-prevention
fi
if (( APPLY )); then
  LC="$(mktemp)"; printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":%d}}]}' "$RETENTION_DAYS" > "$LC"
  printf '  [set]     lifecycle: delete exports older than %d days\n' "$RETENTION_DAYS"
  gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$LC" >/dev/null; rm -f "$LC"
fi

# --- service account + permissions ----------------------------------------------------------
say "4. Service account $SA"
if gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then ok "service account exists"
else miss "service account"; run gcloud iam service-accounts create "$SA_NAME" --display-name="PMR nightly Firestore export"; fi
if (( APPLY )); then
  PNUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  FS_AGENT="service-${PNUM}@gcp-sa-firestore.iam.gserviceaccount.com"
  printf '  [set]     roles/datastore.importExportAdmin for the export account\n'
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
      --role=roles/datastore.importExportAdmin --condition=None >/dev/null
  printf '  [set]     bucket write access for the export account and the Firestore service agent\n'
  for m in "serviceAccount:$SA" "serviceAccount:$FS_AGENT"; do
    gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="$m" --role=roles/storage.admin >/dev/null
  done
fi

# --- scheduler job --------------------------------------------------------------------------
say "5. Nightly job $JOB ($SCHEDULE $TZ_NAME)"
URI="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DB}:exportDocuments"
BODY="{\"outputUriPrefix\":\"gs://${BUCKET}\"}"
if gcloud scheduler jobs describe "$JOB" --location="$SCHED_REGION" >/dev/null 2>&1; then ok "job exists"
else
  miss "job"
  run gcloud scheduler jobs create http "$JOB" --location="$SCHED_REGION" --schedule="$SCHEDULE" \
      --time-zone="$TZ_NAME" --uri="$URI" --http-method=POST --headers="Content-Type=application/json" \
      --message-body="$BODY" --oauth-service-account-email="$SA" \
      --oauth-token-scope="https://www.googleapis.com/auth/datastore" \
      --description="PMR nightly Firestore export to gs://$BUCKET (see scripts/setup_firestore_backups.sh)"
fi

say ""
say "Done. Recent exports:"
gcloud storage ls "gs://$BUCKET/" 2>/dev/null | tail -5 || say "  (none yet)"
(( APPLY )) && say "To run one now instead of waiting for tonight: gcloud scheduler jobs run $JOB --location=$SCHED_REGION"
