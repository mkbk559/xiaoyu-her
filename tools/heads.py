import os,json
H="/opt/her"
A=json.load(open("/opt/her/.nodes-audit.json"))
print("=====DATA TOP 40=====")
for d in A["data"][:40]:
    extra=(" lines=%d"%d["lines"]) if "lines" in d else ""
    print("%-46s %7dKB  %s%s"%(d["path"],d["size"]//1024,d["mtime"],extra))
print()
files=["her-mind.mjs","her-contract.mjs","her-soul.mjs","her-ops.mjs","her-arbiter.mjs","her-verify.mjs","her-complete.mjs","her-world.mjs","her-world-news.py","her-consume.mjs","her-veto.mjs","her-goals.mjs","her-graph.mjs","chat-server.mjs","day.mjs","brain.mjs","world.mjs","night-watch.sh","her-watchdog.sh","self-learn.mjs","daily-toon.mjs","write-novel.mjs"]
for f in files:
    p=os.path.join(H,f)
    print("########",f)
    if not os.path.exists(p): print("  MISSING"); continue
    lines=open(p,encoding="utf-8",errors="ignore").read().splitlines()
    for l in lines[:16]: print("  ",l[:150])
    print()
