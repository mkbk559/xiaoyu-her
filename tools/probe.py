import os, json, subprocess
H="/opt/her"
def sh(c): return subprocess.run(["bash","-lc",c],capture_output=True,text=True).stdout
def tail(p,n):
    if not os.path.exists(p): return "(missing) "+p
    return "\n".join(open(p,encoding="utf-8",errors="ignore").read().splitlines()[-n:])
print("=====her-mind.log tail 35=====")
print(tail("/var/log/her-mind.log",35))
print()
print("=====night-watch.log tail 12=====")
print(tail("/var/log/night-watch.log",12))
print("=====her-watchdog.log tail 12=====")
print(tail("/var/log/her-watchdog.log",12))
print()
print("=====LEARN FILES=====")
print(sh("ls -la /opt/her/*learn* /opt/her/skills* /opt/her/curric* /opt/her/course* /opt/her/knowledge/INDEX.md 2>/dev/null"))
print("=====skills.jsonl=====")
print(tail(H+"/skills.jsonl",10) if os.path.exists(H+"/skills.jsonl") else "MISSING")
print("=====knowledge count=====")
print(sh("ls /opt/her/knowledge | wc -l; du -sh /opt/her/knowledge"))
print("=====knowledge/INDEX.md head=====")
print(tail(H+"/knowledge/INDEX.md",400)[:2500])
print()
print("=====怎么说话.md=====")
p=H+"/skills/怎么说话.md"
print(open(p,encoding="utf-8").read()[:3000] if os.path.exists(p) else "MISSING "+p)
print()
print("=====WIRING: bridge.mjs / chat-server.mjs=====")
for f in ["/opt/herqq/bridge.mjs","/opt/her/chat-server.mjs","/opt/her/chat-log.mjs"]:
    if not os.path.exists(f): print("MISSING",f); continue
    print("##",f)
    for i,line in enumerate(open(f,encoding="utf-8",errors="ignore").read().splitlines(),1):
        if any(k in line for k in ["怎么说话","knowledge","skills","checkPersona","checkSafety","persona","personality","worldBrief","graph","chat-log"]):
            print("  %4d %s"%(i,line.strip()[:150]))
print()
print("=====her-mind.json keys=====")
try:
    d=json.load(open(H+"/her-mind.json"))
    print(list(d.keys()))
    for k,v in d.items():
        s=json.dumps(v,ensure_ascii=False)
        print("  ",k,"=",s[:180])
except Exception as e: print("ERR",e)
