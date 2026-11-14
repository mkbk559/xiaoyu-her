import os, json
H="/opt/her"
scripts=[f for f in os.listdir(H) if f.endswith((".mjs",".py",".sh"))]
texts={}
for f in scripts:
    try: texts[f]=open(os.path.join(H,f),encoding="utf-8",errors="ignore").read()
    except Exception: pass
units=""
for d in ["/etc/systemd/system"]:
    for f in os.listdir(d):
        if f.endswith((".service",".timer")):
            units+=open(os.path.join(d,f),encoding="utf-8",errors="ignore").read()+"\n"
cron=os.popen("crontab -l 2>/dev/null").read()
texts["<systemd>"]=units
texts["<cron>"]=cron
if os.path.isdir("/opt/herqq"):
    for f in os.listdir("/opt/herqq"):
        p="/opt/herqq/"+f
        if os.path.isfile(p):
            try: texts["<herqq:"+f+">"]=open(p,encoding="utf-8",errors="ignore").read()
            except Exception: pass
    texts["<herqqlist>"]="\n".join(os.listdir("/opt/herqq"))
print("==DRIVERS==")
for target in scripts:
    drv=[]
    for src,txt in texts.items():
        if src==target: continue
        if target in txt: drv.append(src.replace("<systemd>","systemd").replace("<cron>","cron"))
    if drv: print(target,"<-",", ".join(drv[:8]))
print()
print("==LIVE SCRIPT LINES (spawn/exec/import context)==")
for target in ["self-learn.mjs","daily-toon.mjs","her-graph.mjs","write-novel.mjs","chat-log.mjs","apply-tuned.py","tune-detector.mjs","content-stats.mjs"]:
    print("### ",target)
    for src,txt in texts.items():
        for line in txt.splitlines():
            if target in line and src!=target:
                print("   [%s] %s"%(src.replace("<systemd>","systemd").replace("<cron>","cron"), line.strip()[:150]))
print()
print("==HERQQLIST==", texts.get("<herqqlist>","NONE"))
print("==HER-LIFE UNIT==")
print(os.popen("systemctl cat her-life.service 2>/dev/null").read())
