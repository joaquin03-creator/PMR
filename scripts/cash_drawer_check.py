#!/usr/bin/env python3
"""
READ-ONLY cash drawer check for a range of days. Writes nothing.

    python3 scripts/cash_drawer_check.py 2026-10-30 2026-11-04 [--entries]

For each day: opening, cash in, cash ticket payouts, cash out, expected (recomputed with the LOCKED formula
expected = opening + replenishments - payouts - expenses), the stored expected, the count (actualCash) and
over/short, plus whether the opening equals the previous day's close. --entries lists every cash in/out line.
Ticket payouts use the app's rule: a ticket counts on its US Eastern date unless voided/cancelled, and only
when paid in cash. Uses `gcloud auth print-access-token` (the owner's login), like the other scripts here.
Written 2026-11-04 during the 10/31-11/03 historical count correction (AGENTS.md §6).
"""
import json, subprocess, urllib.request, urllib.error, datetime, sys, zoneinfo
PROJECT = "gen-lang-client-0857392953"; DB = "ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/{DB}/documents"
TOK = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True).stdout.strip()
TZ = zoneinfo.ZoneInfo("America/New_York")

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json", "x-goog-user-project": PROJECT})
    try: return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e: sys.exit(f"Firestore error {e.code}: {e.read().decode()[:400]}")
def query(sq): return [r["document"] for r in call("POST", ":runQuery", {"structuredQuery": sq}) if r.get("document")]
def eq(field, v): return {"fieldFilter": {"field": {"fieldPath": field}, "op": "EQUAL", "value": {"stringValue": v}}}
def dec(x):
    k, val = next(iter(x.items()))
    if k == "integerValue": return int(val)
    if k == "doubleValue": return float(val)
    if k == "mapValue": return {a: dec(b) for a, b in val.get("fields", {}).items()}
    if k == "arrayValue": return [dec(i) for i in val.get("values", [])]
    if k == "nullValue": return None
    return val
def plain(doc): return {k: dec(x) for k, x in doc.get("fields", {}).items()}
def money(x): return round(x * 100) / 100  # roundMoney (cashLogicLock.ts)
def eastern(iso): return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ)

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if len(args) != 2: sys.exit(__doc__)
first, last = (datetime.date.fromisoformat(a) for a in args)
days = [(first + datetime.timedelta(n)).isoformat() for n in range((last - first).days + 1)]
lo = datetime.datetime.combine(first, datetime.time(), TZ).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
hi = datetime.datetime.combine(last + datetime.timedelta(1), datetime.time(), TZ).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

tickets = query({"from": [{"collectionId": "buyTickets"}], "where": {"compositeFilter": {"op": "AND", "filters": [
    {"fieldFilter": {"field": {"fieldPath": "timestamp"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"stringValue": lo}}},
    {"fieldFilter": {"field": {"fieldPath": "timestamp"}, "op": "LESS_THAN", "value": {"stringValue": hi}}}]}},
    "select": {"fields": [{"fieldPath": p} for p in ["timestamp", "status", "paymentMethod", "totalAmount"]]}})
payouts = {d: 0.0 for d in days}; odd = 0
for t in tickets:
    f = plain(t); d = eastern(f["timestamp"]).strftime("%Y-%m-%d")
    if f.get("status") in ("voided", "cancelled") or f.get("paymentMethod") not in (None, "", "cash"): odd += 1; continue
    if d in payouts: payouts[d] += float(f.get("totalAmount") or 0)

print(f"{'day':11} {'status':11} {'opening':>11} {'cash in':>11} {'tickets':>11} {'cash out':>10} {'expected':>11} "
      f"{'stored':>11} {'count':>11} {'over/short':>11}  opening vs prior close")
prev, total = None, 0.0
for d in days:
    found = query({"from": [{"collectionId": "cashSessions"}], "where": eq("date", d)})
    if not found: print(f"{d:11} no session"); prev = None; continue
    if len(found) > 1: print(f"{d:11} WARNING: {len(found)} sessions for this date -- showing the first")
    s = plain(found[0]); sid = found[0]["name"].split("/")[-1]
    tx = [plain(t) for t in query({"from": [{"collectionId": "cashTransactions"}], "where": eq("sessionId", sid)})]
    cin = money(sum(float(t["amount"]) for t in tx if t.get("type") == "inflow"))
    cout = money(sum(float(t["amount"]) for t in tx if t.get("type") == "expense"))
    exp = money(float(s.get("openingCash") or 0) + cin - money(payouts[d]) - cout)
    act = s.get("actualCash")
    os_ = money(float(act) - exp) if act is not None else None
    carry = "" if prev is None else ("ok" if abs(float(s.get("openingCash") or 0) - prev) < 0.005 else f"DIFFERS (prior close {prev:,.2f})")
    flag = "" if abs(exp - float(s.get("expectedCash") or 0)) < 0.005 else "  <- stored expected differs"
    print(f"{d:11} {s.get('status', ''):11} {float(s.get('openingCash') or 0):>11,.2f} {cin:>11,.2f} {payouts[d]:>11,.2f} {cout:>10,.2f} "
          f"{exp:>11,.2f} {float(s.get('expectedCash') or 0):>11,.2f} {float(act or 0):>11,.2f} {os_ if os_ is not None else '-':>11}  {carry}{flag}")
    if "--entries" in sys.argv:
        for t in sorted(tx, key=lambda t: t.get("timestamp", "")):
            when = eastern(t["timestamp"]).strftime("%m/%d %I:%M %p") if t.get("timestamp") else "?"
            print(f"      {when}  {t.get('type', ''):7} {float(t['amount']):>11,.2f}  {t.get('category', '')}: {(t.get('notes') or '')[:100]}")
    total += os_ or 0
    prev = float(act) if act is not None else None
print(f"\nsum of over/short {days[0]} .. {days[-1]}: {money(total):,.2f}   (tickets skipped as voided/cancelled/non-cash: {odd})")
