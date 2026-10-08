#!/usr/bin/env python3
"""
ONE-TIME cleanup for the 2026-10-06 stuck-tab incident. Dry run by default; --commit to write.

1. Deletes the 24 duplicate ticketDrafts that were flushed to the server in one burst
   (server createTime 2026-10-07T02:42:00Z..02:43:59Z). Nothing outside that window is touched.
2. For the three tickets that reached the server ~8 hours late, adds what the original page
   never got to send: one auditLogs entry (photos stripped) and the inventory increments.
   Each ticket is ONE atomic commit, and the audit doc has a fixed id with an
   "must not already exist" precondition -- so running this twice cannot double-count.
"""
import json, subprocess, urllib.request, datetime, sys
COMMIT="--commit" in sys.argv
PROJECT="gen-lang-client-0857392953"; DB="ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
ROOT=f"projects/{PROJECT}/databases/{DB}/documents"; BASE="https://firestore.googleapis.com/v1/"+ROOT
TOK=subprocess.run(["gcloud","auth","print-access-token"],capture_output=True,text=True).stdout.strip()
RUNNER="joaquinrodriguez3333@gmail.com"
TICKETS=["BUY-20261006-142215","BUY-20261006-145711","BUY-20261006-153345"]
def call(method,path,body=None):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={"Authorization":"Bearer "+TOK,"Content-Type":"application/json","x-goog-user-project":PROJECT})
    try: return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e: return {"__error":e.code,"__body":e.read().decode()[:600]}
def strip(v):
    if "stringValue" in v and v["stringValue"].startswith("data:"): return {"stringValue":"[photo stored on ticket record]"}
    if "mapValue" in v: return {"mapValue":{"fields":{k:strip(x) for k,x in v["mapValue"].get("fields",{}).items()}}}
    if "arrayValue" in v: return {"arrayValue":{"values":[strip(x) for x in v["arrayValue"].get("values",[])]}}
    return v
num=lambda v: float(next(iter(v.values())))
now=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

print("MODE:", "COMMIT" if COMMIT else "DRY RUN (nothing is written)")
# ---- 1. drafts
res=call("POST",":runQuery",{"structuredQuery":{"from":[{"collectionId":"ticketDrafts"}],"select":{"fields":[{"fieldPath":"step"},{"fieldPath":"createdBy"}]}}})
drafts=[r["document"] for r in res if r.get("document")]
burst=[d for d in drafts if "2026-10-07T02:42:00" <= d["createTime"] < "2026-10-07T02:44:00"]
print(f"\nticketDrafts total {len(drafts)}; in the 10:42 PM burst: {len(burst)}; left alone: {len(drafts)-len(burst)}")
for d in drafts:
    if d not in burst: print("   keep  ",d["name"].split("/")[-1],"created",d["createTime"][:19],"by",d["fields"].get("createdBy",{}).get("stringValue"))
assert len(burst)==24, f"expected 24 burst drafts, found {len(burst)} -- stopping"
if COMMIT:
    r=call("POST",":commit",{"writes":[{"delete":d["name"],"currentDocument":{"updateTime":d["updateTime"]}} for d in burst]})
    print("   delete commit:", "OK, "+str(len(r.get("writeResults",[])))+" deleted" if "__error" not in r else r)

# ---- 2. tickets
mats={r["document"]["name"].split("/")[-1]:r["document"]["fields"] for r in call("POST",":runQuery",{"structuredQuery":{"from":[{"collectionId":"materials"}],"select":{"fields":[{"fieldPath":"name"},{"fieldPath":"code"}]}}}) if r.get("document")}
for tid in TICKETS:
    t=call("GET",f"/buyTickets/{tid}")
    assert "fields" in t, (tid,t)
    f=t["fields"]; assert f["status"]["stringValue"]=="completed"
    cname=call("GET",f"/customers/{f['customerId']['stringValue']}?mask.fieldPaths=name").get("fields",{}).get("name",{}).get("stringValue","?")
    existing=[r for r in call("POST",":runQuery",{"structuredQuery":{"from":[{"collectionId":"auditLogs"}],"where":{"fieldFilter":{"field":{"fieldPath":"entityId"},"op":"EQUAL","value":{"stringValue":tid}}},"select":{"fields":[{"fieldPath":"action"}]}}}) if r.get("document")]
    print(f"\n{tid}  {cname}  ${num(f['totalAmount']):.2f}  entered {f['timestamp']['stringValue']}  reached server {t['createTime'][:19]}Z  existing audit entries: {len(existing)}")
    if existing: print("   already has audit entries -- SKIPPING this ticket entirely"); continue
    writes=[]
    for m in f["materials"]["arrayValue"]["values"]:
        mf=m["mapValue"]["fields"]; mid=mf["materialId"]["stringValue"]; net=num(mf["netWeight"])
        inv=call("GET",f"/inventory/{mid}")
        cur=num(inv["fields"]["currentWeight"]) if "fields" in inv and "currentWeight" in inv["fields"] else None
        print(f"   inventory {mats.get(mid,{}).get('name',{}).get('stringValue','?')[:30]:30} +{net:g} lb   book {cur} -> {None if cur is None else cur+net}   (inventory doc last written {inv.get('updateTime','—')[:19]}Z)")
        writes.append({"update":{"name":f"{ROOT}/inventory/{mid}","fields":{"materialId":{"stringValue":mid},"lastUpdated":{"stringValue":now}}},
                       "updateMask":{"fieldPaths":["materialId","lastUpdated"]},
                       "updateTransforms":[{"fieldPath":"currentWeight","increment":({"integerValue":str(int(net))} if float(net).is_integer() else {"doubleValue":net})}]})
    note=(f"[BACKFILL 2026-10-07] Quick Ticket created for {cname}. Ticket was entered {f['timestamp']['stringValue']} but the tab could not reach the server; "
          f"it was saved at {t['createTime'][:19]}Z. This audit entry and the inventory increments were added afterwards because the original page never sent them.")
    audit={"entityType":{"stringValue":"buyTicket"},"entityId":{"stringValue":tid},"action":{"stringValue":"create"},
           "changes":{"mapValue":{"fields":{"after":{"mapValue":{"fields":{k:strip(v) for k,v in f.items()}}}}}},
           "performedBy":{"stringValue":RUNNER},"timestamp":{"stringValue":now},"notes":{"stringValue":note}}
    print(f"   audit entry auditLogs/backfill_{tid}_create  ({len(json.dumps(audit))/1024:.1f} KB, photos stripped)")
    writes.append({"update":{"name":f"{ROOT}/auditLogs/backfill_{tid}_create","fields":audit},"currentDocument":{"exists":False}})
    if COMMIT:
        r=call("POST",":commit",{"writes":writes})
        print("   commit:", f"OK, {len(r.get('writeResults',[]))} writes at {r.get('commitTime')}" if "__error" not in r else r)
