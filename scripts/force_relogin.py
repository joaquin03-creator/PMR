#!/usr/bin/env python3
"""
Force every open PMR session to sign in again, so every station reloads onto the current build.
Dry run by default; --commit to write.

Sets status='logout' on each active userSessions document. Every open tab (old or new build)
watches its own session document and, when it is no longer 'active', signs out and reloads to
the login page. Signing back in marks the session active again. Nothing else is touched.

RUN ONLY OUTSIDE WORK HOURS: a tab that is mid-ticket is sent to the login page.
"""
import json, subprocess, urllib.request, datetime, zoneinfo, sys
COMMIT="--commit" in sys.argv
PROJECT="gen-lang-client-0857392953"; DB="ai-studio-661b304a-fc5e-4d72-a81e-fdbacdf1964c"
ROOT=f"projects/{PROJECT}/databases/{DB}/documents"; BASE="https://firestore.googleapis.com/v1/"+ROOT
TOK=subprocess.run(["gcloud","auth","print-access-token"],capture_output=True,text=True).stdout.strip()
TZ=zoneinfo.ZoneInfo("America/New_York")
def call(path,body):
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+TOK,"Content-Type":"application/json","x-goog-user-project":PROJECT})
    return json.load(urllib.request.urlopen(req))
docs=[r["document"] for r in call(":runQuery",{"structuredQuery":{"from":[{"collectionId":"userSessions"}]}}) if r.get("document")]
now=datetime.datetime.now(datetime.timezone.utc)
print("MODE:", "COMMIT" if COMMIT else "DRY RUN (nothing is written)"); print("sessions on record:",len(docs))
targets=[]
for d in sorted(docs,key=lambda d:d["fields"].get("lastActiveAt",{}).get("stringValue",""),reverse=True):
    f={k:next(iter(v.values())) for k,v in d["fields"].items()}
    last=datetime.datetime.fromisoformat(str(f.get("lastActiveAt","1970-01-01T00:00:00Z")).replace("Z","+00:00"))
    age=(now-last).total_seconds()/60
    ua=str(f.get("userAgent","")); br="Edge" if "Edg/" in ua else "Chrome" if "Chrome/" in ua else "Safari" if "Safari/" in ua else "other"; dev="phone" if "Mobile" in ua else "computer"
    live = f.get("status")=="active" and age<24*60
    print(f"  {str(f.get('userEmail',''))[:34]:34} {f.get('status'):8} last active {last.astimezone(TZ):%m-%d %I:%M %p} ({age:6.0f} min ago)  {dev}/{br}  {'<- would be signed out' if live else ''}")
    if live: targets.append(d)
print("sessions that would be signed out:",len(targets))
if COMMIT and targets:
    stamp=now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    r=call(":commit",{"writes":[{"update":{"name":d["name"],"fields":{"status":{"stringValue":"logout"},"lastActiveAt":{"stringValue":stamp}}},"updateMask":{"fieldPaths":["status","lastActiveAt"]}} for d in targets]})
    print("signed out:",len(r.get("writeResults",[])))
