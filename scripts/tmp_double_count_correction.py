#!/usr/bin/env python3
"""
ONE-TIME backfill: corrects the single confirmed double-decrement caused by the
Trip Ticket / Invoice inventory bug (fixed in src/pages/TripTickets.tsx).

Trip Ticket TRIP-20260818-111714 (created 2026-08-18) deducted inventory at
creation. Invoice INV-094799 (same physical shipment, marked paid 2026-09-03)
also deducted inventory for the same materials/weights. This script adds back
the Trip-Ticket-side amount only, for the 13 materials involved, restoring
each material to what it would be with a single (Invoice-side) deduction.

It writes:
  - one `inventoryAdjustments` doc per material (matches the existing Manual
    Adjustment record shape used by Inventory.tsx, so it shows up in the
    existing Manual Adjustments history/tab)
  - one `auditLogs` doc per material (matches the existing audit log shape)
  - the `inventory/{materialId}.currentWeight` increment itself

All writes are a single atomic Firestore commit (all-or-nothing).

TO REVERSE: open Inventory > Manual Adjustments and, for each material listed
below, create an equal-and-opposite adjustment (same weight, "remove" instead
of "add"). Every write this script makes carries the reason tag
"[DOUBLE-COUNT FIX BACKFILL]" so it's easy to find and audit.

Dry run (prints the before/after table, writes nothing):
  python3 scripts/tmp_double_count_correction.py
Commit for real:
  python3 scripts/tmp_double_count_correction.py --commit
Requires: gcloud auth (same account already used for this project).
"""
import json
import subprocess
import datetime
import urllib.request

PROJECT = "gen-lang-client-0857392953"
DB = "ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
BASE = f"projects/{PROJECT}/databases/{DB}/documents"

# materialId -> lbs to add back (the Trip-Ticket-side amount, computed from
# INV-094799's materials array, which sums to the same 36,501 lbs as the
# Trip Ticket's totalWeight)
DELTAS = {
    "1ZBJc2g8FYG7rvt3MOVk": 25094,  # Bare Bright Copper (2)
    "G2FxW8vh89AEsE7cFrEC": 426,    # EC Wire (22)
    "SGTZDpSQ30fAWTj8iZL7": 3180,   # Steel Case Battery (321)
    "AzxR058LSgyoTPyhQoEG": 896,    # #1 INS 72% ROMEX (6)
    "R1d7IMCiqctclM30vT5e": 1064,   # Yellow Brass CLEAN (8)
    "VKcqvig9eBmkHn3CU9Cb": 246,    # Alum Clip (28)
    "aBdymhp4KlzmW0XPn7Mx": 768,    # #1 INS 85% THHN (611)
    "e2Ku1FlIpEa0L6lqkoRl": 992,    # #1 Copper (3)
    "DQeBooG0Kx1abQwEC2I5": 645,    # #2 Copper (4)
    "GB9Kdqd1vGorbmQBHUED": 690,    # #2 ICW 50% COMM WIRE (42)
    "2UAvbTa3587pDLiTJH9P": 1160,   # Cu-AL Radiators (13)
    "61Iw2iVbU3bOE7syeFtT": 752,    # #2 ICW 50% (7)
    "XNmcHk3xioo3mMY8JSOI": 588,    # #2 ICW 40% (250)
}
assert sum(DELTAS.values()) == 36501

MATERIAL_INFO = {
    "1ZBJc2g8FYG7rvt3MOVk": {"name": "Bare Bright Copper", "code": "2"},
    "G2FxW8vh89AEsE7cFrEC": {"name": "EC Wire", "code": "22"},
    "SGTZDpSQ30fAWTj8iZL7": {"name": "Steel Case Battery", "code": "321"},
    "AzxR058LSgyoTPyhQoEG": {"name": "#1 INS 72% (ROMEX)", "code": "6"},
    "R1d7IMCiqctclM30vT5e": {"name": "Yellow Brass (CLEAN)", "code": "8"},
    "VKcqvig9eBmkHn3CU9Cb": {"name": "Alum Clip", "code": "28"},
    "aBdymhp4KlzmW0XPn7Mx": {"name": "#1 INS 85% (THHN)", "code": "611"},
    "e2Ku1FlIpEa0L6lqkoRl": {"name": "#1 Copper", "code": "3"},
    "DQeBooG0Kx1abQwEC2I5": {"name": "#2 Copper", "code": "4"},
    "GB9Kdqd1vGorbmQBHUED": {"name": "#2 ICW 50% (COMM WIRE)", "code": "42"},
    "2UAvbTa3587pDLiTJH9P": {"name": "Cu-AL Radiators", "code": "13"},
    "61Iw2iVbU3bOE7syeFtT": {"name": "#2 ICW 50%", "code": "7"},
    "XNmcHk3xioo3mMY8JSOI": {"name": "#2 ICW 40%", "code": "250"},
}

REASON = ("[DOUBLE-COUNT FIX BACKFILL] Trip Ticket TRIP-20260818-111714 (created 2026-08-18) "
          "independently deducted this weight in addition to Invoice INV-094799 (marked paid "
          "2026-09-03) for the same physical shipment, before Trip Tickets were changed to be "
          "paperwork-only. This adjustment restores the Trip-Ticket-side over-deduction; the "
          "Invoice-side deduction is the legitimate one and is left in place. Approved by Joaquin "
          "on 2026-09-20. To reverse: create an equal-and-opposite Manual Adjustment for this "
          "material from the Inventory > Manual Adjustments tab.")
RECORDED_BY = "System (double-count fix backfill, approved by Joaquin)"


def get_token():
    return subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()


def http_json(method, url, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("X-Goog-User-Project", PROJECT)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def sval(s): return {"stringValue": s}
def dval(d): return {"doubleValue": float(d)}
def bval(b): return {"booleanValue": b}


def main():
    import sys
    commit = '--commit' in sys.argv
    token = get_token()

    # Fetch current live weights right before writing.
    doc_names = [f"{BASE}/inventory/{mid}" for mid in DELTAS]
    batch_get = http_json(
        "POST",
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DB}/documents:batchGet",
        token,
        {"documents": doc_names},
    )
    current = {}
    for entry in batch_get:
        found = entry.get("found")
        if not found:
            raise SystemExit(f"Missing inventory doc: {entry.get('missing')}")
        mid = found["name"].split("/")[-1]
        cw = found.get("fields", {}).get("currentWeight", {})
        val = cw.get("integerValue", cw.get("doubleValue", 0))
        current[mid] = float(val)

    timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.datetime.utcnow().microsecond // 1000:03d}Z"

    print("Planned correction (current live weights):")
    for mid, delta in DELTAS.items():
        prev = current[mid]
        result = prev + delta
        info = MATERIAL_INFO[mid]
        print(f"  {info['code']:>4} {info['name']:<28} {prev:>10,.1f} -> {result:>10,.1f}  (+{delta:,.0f})")
    total = sum(DELTAS.values())
    print(f"Total weight restored: {total:,.0f} lbs across {len(DELTAS)} materials")

    if not commit:
        print("\nDry run only -- no changes written. Re-run with --commit to write this to production Firestore:")
        print("  python3 scripts/tmp_double_count_correction.py --commit")
        return

    writes = []
    for mid, delta in DELTAS.items():
        prev = current[mid]
        result = prev + delta
        mat = MATERIAL_INFO[mid]
        adj_id = f"DBLCOUNT-{mid}"
        audit_id = f"DBLCOUNT-AUDIT-{mid}"

        writes.append({
            "update": {
                "name": f"{BASE}/inventoryAdjustments/{adj_id}",
                "fields": {
                    "materialId": sval(mid),
                    "materialName": sval(mat["name"]),
                    "materialCode": sval(mat["code"]),
                    "adjustmentAmount": dval(delta),
                    "reason": sval(REASON),
                    "isEstimate": bval(False),
                    "previousWeight": dval(prev),
                    "resultingWeight": dval(result),
                    "timestamp": sval(timestamp),
                    "recordedBy": sval(RECORDED_BY),
                    "recordedByUid": sval(""),
                },
            },
            "currentDocument": {"exists": False},
        })

        writes.append({
            "transform": {
                "document": f"{BASE}/inventory/{mid}",
                "fieldTransforms": [{"fieldPath": "currentWeight", "increment": dval(delta)}],
            }
        })
        writes.append({
            "update": {
                "name": f"{BASE}/inventory/{mid}",
                "fields": {"lastUpdated": sval(timestamp)},
            },
            "updateMask": {"fieldPaths": ["lastUpdated"]},
        })

        audit_notes = (f"Manual Adjustment: +{delta:,.0f} lbs for {mat['name']} ({mat['code']}). "
                        f"Reason: {REASON}")
        writes.append({
            "update": {
                "name": f"{BASE}/auditLogs/{audit_id}",
                "fields": {
                    "entityType": sval("inventory"),
                    "entityId": sval(adj_id),
                    "action": sval("update"),
                    "changes": {"mapValue": {"fields": {
                        "before": {"mapValue": {"fields": {"currentWeight": dval(prev)}}},
                        "after": {"mapValue": {"fields": {
                            "currentWeight": dval(result),
                            "isEstimate": bval(False),
                            "reason": sval(REASON),
                        }}},
                    }}},
                    "performedBy": sval(RECORDED_BY),
                    "timestamp": sval(timestamp),
                    "notes": sval(audit_notes),
                },
            },
            "currentDocument": {"exists": False},
        })

    result = http_json(
        "POST",
        f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DB}/documents:commit",
        token,
        {"writes": writes},
    )
    print(f"\nCommitted {len(result.get('writeResults', []))} writes successfully.")
    print("Backfill complete. Reversal instructions are stored in each adjustment's `reason` field.")


if __name__ == "__main__":
    main()
