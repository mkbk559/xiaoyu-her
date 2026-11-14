import os, subprocess
H="/opt/her"
def sh(c): return subprocess.run(["bash","-lc",c],capture_output=True,text=True).stdout
def tail(p,n):
    if not os.path.exists(p): return "(missing) "+p
    return "\n".join(open(p,encoding="utf-8",errors="ignore").read().splitlines()[-n:])
print("=====her-life.log (dead engine last output)=====")
print(sh("ls -la /var/log/her-life.log /var/log/her-life.err 2>/dev/null"))
print(tail("/var/log/her-life.log",8))
print("=====journal errors (her-chat/herqq-bridge/night-watch)=====")
print(sh("journalctl -u her-chat -u herqq-bridge -u night-watch --since '2026-11-11 00:00' --no-pager 2>/dev/null | grep -Ei 'error|fail|traceback|异常|失败' | tail -12"))
print("=====night-watch.sh=====")
print(open(H+"/night-watch.sh",encoding="utf-8").read()[:2600])
print("=====her-watchdog.sh sections=====")
for l in open(H+"/her-watchdog.sh",encoding="utf-8").read().splitlines():
    s=l.strip()
    if s.startswith("#") and len(s)>6 and not s.startswith("#!"): print("  ",s[:120])
print()
print("=====EXPORTS/FUNCS=====")
for f in ["her-mind.mjs","her-contract.mjs","her-soul.mjs","her-arbiter.mjs","her-ops.mjs","her-verify.mjs","her-complete.mjs","her-world.mjs","her-consume.mjs","her-goals.mjs"]:
    p=os.path.join(H,f)
    print("##",f)
    names=[]
    for l in open(p,encoding="utf-8",errors="ignore").read().splitlines():
        s=l.strip()
        if s.startswith("export function ") or s.startswith("export async function ") or s.startswith("function ") or s.startswith("async function ") or s.startswith("export const "):
            names.append(s.split("(")[0].replace("export ","").replace("async ","")[:44])
    print("   ",", ".join(names[:40]))
print()
print("=====LLM 调用路径=====")
for f in ["her-mind.mjs","her-soul.mjs","her-contract.mjs","brain.mjs","chat-server.mjs"]:
    p=os.path.join(H,f)
    hits=[]
    for i,l in enumerate(open(p,encoding="utf-8",errors="ignore").read().splitlines(),1):
        if any(k in l for k in ["3065","agent2api","brain.mjs","aiji","fetch(","8787","ask("]):
            hits.append((i,l.strip()[:120]))
    print("##",f)
    for i,l in hits[:10]: print("   %4d %s"%(i,l))
print()
print("=====STATE FILES=====")
print(sh("cd /opt/her && ls -la *.json *.jsonl 2>/dev/null | head -50"))
print("=====DIRS=====")
print(sh("cd /opt/her && for d in novel toon-episodes chats knowledge skills portfolio _archive; do echo -n \": \"; ls  2>/dev/null | wc -l; done"))
