#!/usr/bin/env python3
"""
ONE-TIME correction for 2026-10-20. Dry run by default; --commit to write.

BUY-20261020-153623 (Allen E Jones, Old Sheet @ $0.36 = $48.96) was rung up again at the
customer's price as BUY-20261020-154213 ($65.28) and he was paid the difference -- but the
first ticket was never voided, so the 10/20 drawer counts its $48.96 payout twice
(shown as +$53.74 over; really about +$4.78).

Does what the app's Redo With New Price does after the fact, in ONE atomic commit:
  1. voids 153623 (status + voidedAt/voidedBy/voidReason/replacedByTicketId), only if it has
     not changed since it was read (updateTime precondition);
  2. takes its inventory back out (per line, from the material the line counts as now);
  3. marks 154213 as the redo (redoOfTicketId / redoPriorPayout) -- display only;
  4. the 10/20 cash session: expectedCash and overShort with the LOCKED formulas
     (expected = opening + replenishments - payouts - expenses; overShort = actual - expected),
     only if the session has not changed since it was read;
  5. two audit entries with fixed ids and a must-not-exist precondition, so a second run
     fails instead of reversing anything twice.
The 10/20 Ohio report is NOT touched (already filed; any amendment is the owner's call).
"""
import json, subprocess, urllib.request, urllib.error, datetime, sys, zoneinfo
COMMIT = "--commit" in sys.argv
PROJECT = "gen-lang-client-0857392953"; DB = "ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
ROOT = f"projects/{PROJECT}/databases/{DB}/documents"; BASE = "https://firestore.googleapis.com/v1/" + ROOT
TOK = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True).stdout.strip()
RUNNER = "joaquinrodriguez3333@gmail.com"
ORIGINAL = "BUY-20261020-153623"; REPLACEMENT = "BUY-20261020-154213"; DAY = "2026-10-20"
TZ = zoneinfo.ZoneInfo("America/New_York")

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json", "x-goog-user-project": PROJECT})
    try: return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e: return {"__error": e.code, "__body": e.read().decode()[:800]}
def query(sq): return [r["document"] for r in call("POST", ":runQuery", {"structuredQuery": sq}) if r.get("document")]
def eq(field, v): return {"fieldFilter": {"field": {"fieldPath": field}, "op": "EQUAL", "value": {"stringValue": v}}}
def num(v): return float(next(iter(v.values()))) if v else 0.0
def s(f, k): return f.get(k, {}).get("stringValue")
def money(x): return round(x * 100) / 100  # roundMoney (cashLogicLock.ts)
def fnum(x): return {"integerValue": str(int(x))} if float(x).is_integer() else {"doubleValue": x}
def eastern_day(iso): return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).strftime("%Y-%m-%d")
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

print("MODE:", "COMMIT" if COMMIT else "DRY RUN (nothing is written)")
orig = call("GET", f"/buyTickets/{ORIGINAL}"); repl = call("GET", f"/buyTickets/{REPLACEMENT}")
assert "fields" in orig and "fields" in repl, (orig, repl)
of, rf = orig["fields"], repl["fields"]
assert (s(of, "status") or "completed") == "completed", f"{ORIGINAL} is already {s(of, 'status')} -- nothing to do"
assert s(of, "customerId") == s(rf, "customerId"), "the two tickets are for different customers -- stopping"
assert eastern_day(s(of, "timestamp")) == DAY == eastern_day(s(rf, "timestamp"))
o_total, r_total = num(of["totalAmount"]), num(rf["totalAmount"])
print(f"\n{ORIGINAL}  ${o_total:.2f}  {s(of, 'timestamp')}  {s(of, 'paymentMethod') or 'cash'}  -> will be VOIDED")
print(f"{REPLACEMENT}  ${r_total:.2f}  {s(rf, 'timestamp')}  (stays; difference paid ${money(r_total - o_total):.2f})")

# Lines as they count now (a reclassification moves a line's weight to another material).
lines = [m["mapValue"]["fields"] for m in of["materials"]["arrayValue"]["values"]]
material_of = [s(m, "materialId") for m in lines]
recl = sorted(query({"from": [{"collectionId": "materialReclassifications"}], "where": eq("ticketId", ORIGINAL)}),
              key=lambda d: s(d["fields"], "timestamp") or "")
for d in recl:
    f = d["fields"]
    for i in f.get("lineIndexes", {}).get("arrayValue", {}).get("values", []):
        material_of[int(num(i))] = s(f, "toMaterialId")
print(f"reclassifications on {ORIGINAL}: {len(recl)}")

writes = []
writes.append({"update": {"name": f"{ROOT}/buyTickets/{ORIGINAL}", "fields": {
    "status": {"stringValue": "voided"}, "voidedAt": {"stringValue": now}, "voidedBy": {"stringValue": RUNNER},
    "voidReason": {"stringValue": f"Redone with new price as #{REPLACEMENT} (corrected 2026-10-26)"},
    "replacedByTicketId": {"stringValue": REPLACEMENT}}},
    "updateMask": {"fieldPaths": ["status", "voidedAt", "voidedBy", "voidReason", "replacedByTicketId"]},
    "currentDocument": {"updateTime": orig["updateTime"]}})
for m, mid in zip(lines, material_of):
    net = num(m.get("netWeight"))
    inv = call("GET", f"/inventory/{mid}")
    cur = num(inv["fields"]["currentWeight"]) if "fields" in inv and "currentWeight" in inv["fields"] else None
    name = call("GET", f"/materials/{mid}?mask.fieldPaths=name").get("fields", {}).get("name", {}).get("stringValue", "?")
    print(f"   inventory {name[:30]:30} -{net:g} lb   book {cur} -> {None if cur is None else cur - net}")
    writes.append({"update": {"name": f"{ROOT}/inventory/{mid}", "fields": {"materialId": {"stringValue": mid}, "lastUpdated": {"stringValue": now}}},
                   "updateMask": {"fieldPaths": ["materialId", "lastUpdated"]},
                   "updateTransforms": [{"fieldPath": "currentWeight", "increment": fnum(-net)}]})
writes.append({"update": {"name": f"{ROOT}/buyTickets/{REPLACEMENT}", "fields": {
    "redoOfTicketId": {"stringValue": ORIGINAL}, "redoPriorPayout": fnum(o_total)}},
    "updateMask": {"fieldPaths": ["redoOfTicketId", "redoPriorPayout"]},
    "currentDocument": {"updateTime": repl["updateTime"]}})

# ---- the 10/20 cash session, recomputed with the locked formulas
sessions = query({"from": [{"collectionId": "cashSessions"}], "where": eq("date", DAY)})
assert len(sessions) == 1, f"expected one {DAY} session, found {len(sessions)}"
sess = sessions[0]; sf = sess["fields"]; sid = sess["name"].split("/")[-1]
assert s(sf, "status") != "provisional", "provisional day -- stopping (no count to compare against)"
opening = num(sf.get("openingCash"))
txs = [d["fields"] for d in query({"from": [{"collectionId": "cashTransactions"}], "where": eq("sessionId", sid)})]
inflow = sum(num(t["amount"]) for t in txs if s(t, "type") == "inflow")
expense = sum(num(t["amount"]) for t in txs if s(t, "type") == "expense")
tickets = query({"from": [{"collectionId": "buyTickets"}], "where": {"compositeFilter": {"op": "AND", "filters": [
    {"fieldFilter": {"field": {"fieldPath": "timestamp"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"stringValue": "2026-10-20T00:00:00"}}},
    {"fieldFilter": {"field": {"fieldPath": "timestamp"}, "op": "LESS_THAN", "value": {"stringValue": "2026-10-22T00:00:00"}}}]}},
    "select": {"fields": [{"fieldPath": p} for p in ["timestamp", "status", "paymentMethod", "totalAmount"]]}})
def payout(d, voiding):
    f = d["fields"]; tid = d["name"].split("/")[-1]
    st = "voided" if (voiding and tid == ORIGINAL) else (s(f, "status") or "completed")
    pm = s(f, "paymentMethod")
    if eastern_day(s(f, "timestamp")) != DAY or st in ("voided", "cancelled") or pm not in (None, "cash"): return 0.0
    return num(f.get("totalAmount"))
before_pay = money(sum(payout(d, False) for d in tickets)); after_pay = money(sum(payout(d, True) for d in tickets))
actual = num(sf["actualCash"]) if "actualCash" in sf else None
exp_before = money(opening + inflow - before_pay - expense); exp_after = money(opening + inflow - after_pay - expense)
os_after = money(actual - exp_after) if actual is not None else None
print(f"\ncash session {sid} ({DAY}, {s(sf, 'status')})")
print(f"   opening {opening:.2f}  + in {inflow:.2f}  - payouts {before_pay:.2f} -> {after_pay:.2f}  - expenses {expense:.2f}")
print(f"   expectedCash stored {num(sf.get('expectedCash')):.2f}  recomputed now {exp_before:.2f}  after void {exp_after:.2f}")
print(f"   actualCash {actual}   overShort stored {num(sf.get('overShort')) if 'overShort' in sf else None}  after void {os_after}")
assert abs(exp_before - num(sf.get("expectedCash"))) < 0.005, "stored expected cash does not match a recompute -- stopping"
assert abs((before_pay - after_pay) - o_total) < 0.005
fields = {"expectedCash": fnum(exp_after)}
if os_after is not None: fields["overShort"] = fnum(os_after)
writes.append({"update": {"name": f"{ROOT}/cashSessions/{sid}", "fields": fields}, "updateMask": {"fieldPaths": list(fields)},
               "currentDocument": {"updateTime": sess["updateTime"]}})

note = (f"Voided Buy Ticket #{ORIGINAL} (Total payout: ${o_total:.2f}). Redone with new price as #{REPLACEMENT} "
        f"(${r_total:.2f}) on {DAY}; the customer was paid the difference ${money(r_total - o_total):.2f}. "
        f"The void was missed at the time and was applied 2026-10-26 by the owner's correction script.")
audits = {
    f"redo_void_{ORIGINAL}": {"entityType": "buyTicket", "entityId": ORIGINAL, "action": "void",
        "changes": {"before": {"status": "completed"}, "after": {"status": "voided", "replacedByTicketId": REPLACEMENT}}, "notes": note},
    f"correction_{DAY}_{sid}": {"entityType": "cashSession", "entityId": sid, "action": "update",
        "changes": {"before": {"expectedCash": exp_before, "overShort": num(sf.get("overShort")) if "overShort" in sf else None},
                    "after": {"expectedCash": exp_after, "overShort": os_after}},
        "notes": f"{DAY} expected cash recomputed after voiding #{ORIGINAL} (its ${o_total:.2f} payout was counted twice)."},
}
def enc(v):
    if v is None: return {"nullValue": None}
    if isinstance(v, str): return {"stringValue": v}
    if isinstance(v, (int, float)): return fnum(v)
    if isinstance(v, dict): return {"mapValue": {"fields": {k: enc(x) for k, x in v.items()}}}
    raise TypeError(v)
for aid, a in audits.items():
    writes.append({"update": {"name": f"{ROOT}/auditLogs/{aid}", "fields": {**{k: enc(v) for k, v in a.items()},
                   "performedBy": enc(RUNNER), "timestamp": enc(now)}}, "currentDocument": {"exists": False}})
    print(f"   audit entry auditLogs/{aid}")

print(f"\n{len(writes)} writes in one commit")
if COMMIT:
    r = call("POST", ":commit", {"writes": writes})
    print("commit:", f"OK, {len(r.get('writeResults', []))} writes at {r.get('commitTime')}" if "__error" not in r else r)
