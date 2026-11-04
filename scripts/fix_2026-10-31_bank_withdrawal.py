#!/usr/bin/env python3
"""
ONE-TIME correction for 2026-10-31 .. 2026-11-03. Dry run by default; --commit to write.

The drawer was not counted at the end of Sat 10/31 or Sun 11/01. While reconstructing those
days backwards from the 11/03 night count, the cash that came in was entered as estimates
($15,122 on 10/31, $33,500 on 11/01), 10/31's close was typed as a Quick Cash total ($18,067),
and 11/02's real bill-by-bill count ($14,784.35, 8:59 PM) was stepped down to $11,119.35 to
match a back-calculated 11/03 opening.
Owner (2026-11-04): the real cash in was ONE $50,000 after-hours bank withdrawal on Sat 10/31;
put the real counts back; Mendoza's $400 (11/02) was paid AFTER the 11/02 night count.

In ONE atomic commit (every document must be unchanged since it was read):
  1. deletes the two estimated Bank Run entries (10/31 $15,122, 11/01 $33,500);
  2. records one $50,000 Bank Run on 10/31;
  3. 10/31 and 11/01 (not counted at end of day): closing = expected cash, over/short 0, a note
     saying so; 10/31's leftover bill breakdown is removed (its 3:14 PM count goes in the note);
  4. 11/02: opening = 11/01's close; its real 8:59 PM count is restored (total + bill breakdown,
     taken from that audit entry); leftover opening breakdown removed;
  5. Mendoza's $400 moves to 11/03 (sessionId only, like the app's "Move to another day");
  6. 11/03: opening = 11/02's real count; leftover opening breakdown removed; its own count stays;
  7. expected cash / over-short with the LOCKED formulas
     (expected = opening + replenishments - payouts - expenses; overShort = actual - expected);
  8. audit entries with fixed ids and a must-not-exist precondition, so a second run fails.
Tickets, inventory and the Ohio reports are not touched.
"""
import json, subprocess, urllib.request, urllib.error, datetime, sys, zoneinfo
COMMIT = "--commit" in sys.argv
PROJECT = "gen-lang-client-0857392953"; DB = "ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
ROOT = f"projects/{PROJECT}/databases/{DB}/documents"; BASE = "https://firestore.googleapis.com/v1/" + ROOT
TOK = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True).stdout.strip()
RUNNER = "joaquinrodriguez3333@gmail.com"
TZ = zoneinfo.ZoneInfo("America/New_York")
D31, D01, D02, D03 = DAYS = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]
REMOVE = {"alpNuo6QeeTPoLQPAnla": (D31, 15122), "M6zO6I3iVA95vRUV4MKk": (D01, 33500)}
MOVE_TX, MOVE_FROM, MOVE_TO, MOVE_AMOUNT = "QSBwSAzCaDmfYHvVrVfp", D02, D03, 400  # Mendoza, paid after the 11/02 count
NEW_TX_ID = "fix_20261031_bank_withdrawal"
WITHDRAWAL = 50000
WITHDRAWAL_TIME = "2026-10-31T16:00:00.000Z"  # 12:00 PM Eastern, Sat 10/31 (exact time not recorded)
MIDDAY_COUNT = 17705.45                       # 10/31 bill-by-bill count at 3:14 PM
COUNT_02_AUDIT = "F0EoJYfn0Ypk9SAHkbZK"        # 11/02 8:59 PM autosave holding the real count
COUNT_02 = 14784.35

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json", "x-goog-user-project": PROJECT})
    try: return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e: return {"__error": e.code, "__body": e.read().decode()[:800]}
def query(sq): return [r["document"] for r in call("POST", ":runQuery", {"structuredQuery": sq}) if r.get("document")]
def eq(field, v): return {"fieldFilter": {"field": {"fieldPath": field}, "op": "EQUAL", "value": {"stringValue": v}}}
def dec(x):
    k, val = next(iter(x.items()))
    if k == "integerValue": return int(val)
    if k == "mapValue": return {a: dec(b) for a, b in val.get("fields", {}).items()}
    if k == "arrayValue": return [dec(i) for i in val.get("values", [])]
    if k == "nullValue": return None
    return val
def plain(doc): return {k: dec(x) for k, x in doc["fields"].items()}
def money(x): return round(x * 100) / 100  # roundMoney (cashLogicLock.ts)
def fnum(x): return {"integerValue": str(int(x))} if float(x).is_integer() else {"doubleValue": x}
def enc(v):
    if v is None: return {"nullValue": None}
    if isinstance(v, bool): return {"booleanValue": v}
    if isinstance(v, str): return {"stringValue": v}
    if isinstance(v, (int, float)): return fnum(v)
    if isinstance(v, dict): return {"mapValue": {"fields": {k: enc(x) for k, x in v.items()}}}
    raise TypeError(v)
def eastern_day(iso): return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).strftime("%Y-%m-%d")
def usd(x): return f"${x:,.2f}"
def tid_of(doc): return doc["name"].split("/")[-1]
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

print("MODE:", "COMMIT" if COMMIT else "DRY RUN (nothing is written)")

# ---- sessions
sess = {}
for day in DAYS:
    found = query({"from": [{"collectionId": "cashSessions"}], "where": eq("date", day)})
    assert len(found) == 1, f"expected one {day} session, found {len(found)}"
    sess[day] = found[0]
    assert plain(found[0]).get("status") == "closed", f"{day} is {plain(found[0]).get('status')} -- stopping"
sid = {d: tid_of(sess[d]) for d in DAYS}
sf = {d: plain(sess[d]) for d in DAYS}

# ---- cash entries
txs = {day: query({"from": [{"collectionId": "cashTransactions"}], "where": eq("sessionId", sid[day])}) for day in DAYS}
def find_tx(tid, day):
    match = [t for t in txs[day] if tid_of(t) == tid]
    assert match, f"cash entry {tid} not found on {day} -- already changed? stopping"
    return match[0]
for tid, (day, amount) in REMOVE.items():
    f = plain(find_tx(tid, day)); assert f["type"] == "inflow" and abs(float(f["amount"]) - amount) < 0.005, (tid, f)
mf = plain(find_tx(MOVE_TX, MOVE_FROM)); assert mf["type"] == "expense" and abs(float(mf["amount"]) - MOVE_AMOUNT) < 0.005, mf
for day in (D31, D01):
    others = [t for t in txs[day] if tid_of(t) not in REMOVE]
    assert not others, f"{day} has other cash entries {[(tid_of(o), plain(o)['amount']) for o in others]} -- stopping"
assert "fields" not in call("GET", f"/cashTransactions/{NEW_TX_ID}"), "the $50,000 entry already exists -- already run"

def entries(day, after):
    """(type, amount) of a day's cash entries, now or after this correction."""
    out = []
    for t in txs[day]:
        f = plain(t); i = tid_of(t)
        if after and (i in REMOVE or i == MOVE_TX): continue
        out.append((f["type"], float(f["amount"])))
    if after and day == D31: out.append(("inflow", WITHDRAWAL))
    if after and day == MOVE_TO: out.append(("expense", float(mf["amount"])))
    return out
def inflow(day, after): return money(sum(a for t, a in entries(day, after) if t == "inflow"))
def expense(day, after): return money(sum(a for t, a in entries(day, after) if t == "expense"))

# ---- ticket payouts by Eastern day (same rule as the app: not voided/cancelled, cash payout)
tickets = query({"from": [{"collectionId": "buyTickets"}], "where": {"compositeFilter": {"op": "AND", "filters": [
    {"fieldFilter": {"field": {"fieldPath": "timestamp"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"stringValue": "2026-10-31T00:00:00"}}},
    {"fieldFilter": {"field": {"fieldPath": "timestamp"}, "op": "LESS_THAN", "value": {"stringValue": "2026-11-05T00:00:00"}}}]}},
    "select": {"fields": [{"fieldPath": p} for p in ["timestamp", "status", "paymentMethod", "totalAmount"]]}})
payouts = {d: 0.0 for d in DAYS}
for t in tickets:
    f = plain(t); day = eastern_day(f["timestamp"])
    if day in payouts and f.get("status") not in ("voided", "cancelled") and (not f.get("paymentMethod") or f.get("paymentMethod") == "cash"):
        payouts[day] += float(f.get("totalAmount") or 0)
payouts = {d: money(v) for d, v in payouts.items()}

# ---- the stored records must match a recompute before anything changes
for day in DAYS:
    exp_now = money(float(sf[day]["openingCash"]) + inflow(day, False) - payouts[day] - expense(day, False))
    assert abs(exp_now - float(sf[day]["expectedCash"])) < 0.005, f"{day}: stored expected {sf[day]['expectedCash']} != recompute {exp_now} -- stopping"

# ---- the real 11/02 count, from the audit entry written when it was entered
a = call("GET", f"/auditLogs/{COUNT_02_AUDIT}"); assert "fields" in a, a
af = plain(a); assert af["entityId"] == sid[D02], af["entityId"]
count02 = af["changes"]["after"]["closingDenominations"]
assert abs(money(sum(float(x) for x in count02.values())) - COUNT_02) < 0.005 and abs(float(af["changes"]["after"]["actualCash"]) - COUNT_02) < 0.005
count02_at = af["timestamp"]

# ---- new figures, chained with the locked formulas
new = {}
def expected(day, opening): return money(opening + inflow(day, True) - payouts[day] - expense(day, True))
o31 = float(sf[D31]["openingCash"]); e31 = expected(D31, o31)
new[D31] = {"openingCash": o31, "expectedCash": e31, "actualCash": e31, "overShort": 0}
e01 = expected(D01, e31)
new[D01] = {"openingCash": e31, "expectedCash": e01, "actualCash": e01, "overShort": 0}
e02 = expected(D02, e01)
new[D02] = {"openingCash": e01, "expectedCash": e02, "actualCash": COUNT_02, "overShort": money(COUNT_02 - e02),
            "closingDenominations": count02, "closingCountUpdatedAt": count02_at}
a03 = float(sf[D03]["actualCash"]); e03 = expected(D03, COUNT_02)
new[D03] = {"openingCash": COUNT_02, "expectedCash": e03, "actualCash": a03, "overShort": money(a03 - e03)}

print(f"\n{'day':11} {'':6} {'opening':>12} {'cash in':>11} {'tickets':>11} {'expenses':>9} {'expected':>12} {'close':>12} {'over/short':>11}")
for day in DAYS:
    o, n = sf[day], new[day]
    print(f"{day:11} {'now':6} {usd(float(o['openingCash'])):>12} {usd(inflow(day, False)):>11} {usd(payouts[day]):>11} {usd(expense(day, False)):>9} "
          f"{usd(float(o['expectedCash'])):>12} {usd(float(o['actualCash'])):>12} {usd(float(o['overShort'])):>11}")
    print(f"{'':11} {'after':6} {usd(n['openingCash']):>12} {usd(inflow(day, True)):>11} {usd(payouts[day]):>11} {usd(expense(day, True)):>9} "
          f"{usd(n['expectedCash']):>12} {usd(n['actualCash']):>12} {usd(n['overShort']):>11}")
print(f"{'total over/short':>30}  now {usd(money(sum(float(sf[d]['overShort']) for d in DAYS)))}   after {usd(money(sum(new[d]['overShort'] for d in DAYS)))}")

# ---- writes
writes, audits = [], {}
for tid, (day, _) in REMOVE.items():
    doc = find_tx(tid, day); f = plain(doc)
    writes.append({"delete": doc["name"], "currentDocument": {"updateTime": doc["updateTime"]}})
    audits[f"fix20261031_delete_{tid}"] = {"entityType": "cashTransaction", "entityId": tid, "action": "delete",
        "changes": {"before": f, "after": None},
        "notes": f"Deleted estimated {usd(float(f['amount']))} Bank Run on {day}: replaced by the real $50,000.00 after-hours bank withdrawal of Sat 10/31 (owner, 2026-11-04)."}
new_tx = {"sessionId": sid[D31], "type": "inflow", "category": "Bank Run", "amount": WITHDRAWAL,
          "timestamp": WITHDRAWAL_TIME, "performedBy": RUNNER,
          "notes": "After-hours bank withdrawal for the Saturday client meeting (owner, 2026-11-04). Exact time not recorded. Replaces the estimated entries of $15,122 (10/31) and $33,500 (11/01)."}
writes.append({"update": {"name": f"{ROOT}/cashTransactions/{NEW_TX_ID}", "fields": {k: enc(v) for k, v in new_tx.items()}},
               "currentDocument": {"exists": False}})
audits[f"fix20261031_create_{NEW_TX_ID}"] = {"entityType": "cashTransaction", "entityId": NEW_TX_ID, "action": "adjustment",
    "changes": {"after": new_tx}, "notes": "Cash drawer deposit/bank run for session 2026-10-31: Logged inflow of $50,000.00 (Bank Run), the real after-hours withdrawal (owner correction 2026-11-04)."}
mdoc = find_tx(MOVE_TX, MOVE_FROM)
writes.append({"update": {"name": mdoc["name"], "fields": {"sessionId": enc(sid[MOVE_TO])}}, "updateMask": {"fieldPaths": ["sessionId"]},
               "currentDocument": {"updateTime": mdoc["updateTime"]}})
audits[f"fix20261031_move_{MOVE_TX}"] = {"entityType": "cashTransaction", "entityId": MOVE_TX, "action": "update",
    "changes": {"before": {"sessionId": sid[MOVE_FROM]}, "after": {"sessionId": sid[MOVE_TO]}},
    "notes": f"Moved {usd(float(mf['amount']))} {mf['category']} ({mf.get('notes') or ''}) from {MOVE_FROM} to {MOVE_TO}: paid after the 11/02 night count (owner, 2026-11-04). Timestamp kept."}

not_counted = "Not counted at end of day; closing set to expected cash (owner correction 2026-11-04)."
notes = {
    D31: f"{not_counted} Mid-day bill-by-bill count at 3:14 PM: {usd(MIDDAY_COUNT)} (expected then $17,706.19), taken before the 3:35 PM and 6:04 PM tickets. Cash in: $50,000 after-hours bank withdrawal.",
    D01: not_counted,
    D02: "Real bill-by-bill count of 8:59 PM restored (owner correction 2026-11-04). Mendoza $400 was paid after this count and is on 11/03.",
    D03: "Opening = 11/02's real night count (owner correction 2026-11-04). Includes Mendoza $400, paid after that count.",
}
removed = {D31: ["closingDenominations", "closingCountUpdatedAt"], D01: ["closingCountUpdatedAt"],
           D02: ["openingDenominations"], D03: ["openingDenominations"]}
for day in DAYS:
    o, n = sf[day], dict(new[day])
    n["notes"] = (o.get("notes") + " " if o.get("notes") else "") + notes[day]
    changed = [k for k in n if o.get(k) != n[k]]
    gone = [k for k in removed[day] if k in o]
    writes.append({"update": {"name": f"{ROOT}/cashSessions/{sid[day]}", "fields": {k: enc(n[k]) for k in changed}},
                   "updateMask": {"fieldPaths": changed + gone}, "currentDocument": {"updateTime": sess[day]["updateTime"]}})
    audits[f"fix20261031_session_{day}_{sid[day]}"] = {"entityType": "cashDrawer", "entityId": sid[day], "action": "adjustment",
        "changes": {"before": {k: o.get(k) for k in changed + gone}, "after": {**{k: n[k] for k in changed}, **{k: None for k in gone}}},
        "notes": f"{day} corrected: $50,000 after-hours withdrawal of Sat 10/31, real counts restored (owner, 2026-11-04). Locked formulas: expected {usd(n['expectedCash'])}, over/short {usd(n['overShort'])}."
                 + (f" Removed leftover breakdown(s): {', '.join(gone)}." if gone else "")}
    print(f"   {day}: set {changed}  remove {gone}")
for aid, a in audits.items():
    writes.append({"update": {"name": f"{ROOT}/auditLogs/{aid}", "fields": {**{k: enc(v) for k, v in a.items()},
                   "performedBy": enc(RUNNER), "timestamp": enc(now)}}, "currentDocument": {"exists": False}})
    print(f"   audit entry auditLogs/{aid}")

print(f"\n{len(writes)} writes in one commit")
if COMMIT:
    r = call("POST", ":commit", {"writes": writes})
    print("commit:", f"OK, {len(r.get('writeResults', []))} writes at {r.get('commitTime')}" if "__error" not in r else r)
