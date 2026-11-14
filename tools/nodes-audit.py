import os, json, subprocess, time
H = "/opt/her"; OUT = "/opt/her/.nodes-audit.json"
def sh(c):
    return subprocess.run(["bash","-lc",c],capture_output=True,text=True).stdout
def ts(p):
    try: return time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(p)))
    except Exception: return ""
A = {}
units=[]
for line in sh("systemctl list-units --type=service --all --no-pager --no-legend").splitlines():
    p=line.split()
    if p: units.append({"unit":p[0],"active":p[2] if len(p)>2 else "","sub":p[3] if len(p)>3 else ""})
A["units"]=units
frag={}
for u in units:
    n=u["unit"]
    if any(k in n for k in ["her","aiji","napcat","agent2api","xvfb","qq","chat"]):
        frag[n]=sh("systemctl cat %s 2>/dev/null | grep -E ExecStart | head -6"%n)
A["unit_frags"]=frag
A["timers_raw"]=sh("systemctl list-timers --all --no-pager --no-legend")
A["enabled"]=sh("systemctl list-unit-files --type=service,timer --no-pager --no-legend | grep -Ei her || true")
A["cron"]=sh("crontab -l 2>/dev/null; echo CROND; cat /etc/cron.d/* 2>/dev/null | grep -v '^#' | grep -v '^$'")
files=[]
for f in sorted(os.listdir(H)):
    p=os.path.join(H,f)
    if os.path.isfile(p):
        files.append({"name":f,"size":os.path.getsize(p),"mtime":ts(p)})
A["files"]=files
def purpose(p):
    try: src=open(p,encoding="utf-8",errors="ignore").read(3000)
    except Exception: return ""
    if '"""' in src:
        rest=src.split('"""',1)[1]
        for L in rest.splitlines():
            L=L.strip()
            if L: return L[:90]
    for line in src.splitlines()[:8]:
        s=line.strip()
        if s.startswith("//"): return s[2:].strip()[:90]
        if s.startswith("#") and not s.startswith("#!"): return s[1:].strip()[:90]
    return ""
scripts={}
for f in sorted(os.listdir(H)):
    if f.endswith((".mjs",".py",".sh")):
        p=os.path.join(H,f)
        if os.path.isfile(p): scripts[f]={"purpose":purpose(p),"size":os.path.getsize(p),"mtime":ts(p)}
A["scripts"]=scripts
def dep_of(s, tag):
    i=s.find(tag)
    if i<0: return None
    rest=s[i+len(tag):].lstrip()
    if not rest: return None
    q=rest[0]
    if q not in "'\"": return None
    j=rest.find(q,1)
    if j<0: return None
    return rest[1:j]
imports={}
for f in scripts:
    if not f.endswith(".mjs"): continue
    try: src=open(os.path.join(H,f),encoding="utf-8",errors="ignore").read()
    except Exception: continue
    deps=set()
    for line in src.splitlines():
        for tag in ["from ", "import(", "require("]:
            d=dep_of(line, tag)
            if d: deps.add(os.path.basename(d))
    imports[f]=sorted([d for d in deps if d.endswith((".mjs",".js"))])
A["imports"]=imports
refs={f:set() for f in scripts}
for s,deps in imports.items():
    for d in deps:
        if d in refs: refs[d].add(s)
A["imported_by"]={k:sorted(v) for k,v in refs.items()}
tl=sh("grep -rIl --exclude-dir=node_modules --exclude-dir=__pycache__ --exclude-dir=_archive . /opt/her 2>/dev/null | head -400").split()
corpus={}
for p in tl:
    try: corpus[p]=open(p,encoding="utf-8",errors="ignore").read()
    except Exception: pass
corpus["UNITS"]=sh("cat /etc/systemd/system/*.service /etc/systemd/system/*.timer 2>/dev/null")+A["cron"]
mention={}
for f in scripts:
    n=0
    for p,txt in corpus.items():
        if p.endswith("/"+f): continue
        n+=txt.count(f)
    mention[f]=n
A["mention_count"]=mention
data=[]
for root,dirs,fs in os.walk(H):
    dirs[:]=[d for d in dirs if d not in ("node_modules","__pycache__","_archive",".git","ego-win","portfolio","cast-px","cast-px-t")]
    for f in fs:
        if f.endswith((".json",".jsonl",".db",".log",".md",".txt")):
            p=os.path.join(root,f)
            try: sz=os.path.getsize(p)
            except Exception: continue
            if sz<200: continue
            i={"path":p.replace(H+"/",""),"size":sz,"mtime":ts(p)}
            if f.endswith(".jsonl"):
                try:
                    ls=open(p,encoding="utf-8",errors="ignore").read().splitlines()
                    i["lines"]=len(ls); i["last"]=ls[-1][:150] if ls else ""
                except Exception: pass
            data.append(i)
data.sort(key=lambda x:-x["size"]); A["data"]=data[:60]; A["data_total"]=len(data)
logs={}
for lg in ["/var/log/her-mind.log","/var/log/her-chat.log","/var/log/herqq-bridge.log","/var/log/night-watch.log","/var/log/her-watchdog.log","/var/log/her-news.log","/var/log/napcat.log","/var/log/chrome-guard.log","/root/her/mem-guard.log"]:
    if os.path.exists(lg):
        txt=sh("tail -400 %s"%lg)
        err=[l for l in txt.splitlines() if any(k in l for k in ["ERROR","Error","失败","FAIL","Traceback","异常"])]
        logs[lg]={"lines":len(txt.splitlines()),"err_count":len(err),"err":err[-6:]}
A["logs"]=logs
A["ports"]=sh("ss -lntp | grep LISTEN | awk '{print , }'")
A["sys"]=sh("df -h / | tail -1; free -m | head -2; uptime")
A["archive"]=sh("ls /opt/her/_archive 2>/dev/null | head -20; echo BAKS; ls /opt/her/*.bak* 2>/dev/null | head -20")
syn={}
for f in scripts:
    p=os.path.join(H,f)
    if f.endswith(".mjs"):
        r=subprocess.run(["/opt/node/bin/node","--check",p],capture_output=True,text=True)
        if r.returncode!=0:
            L=r.stderr.strip().splitlines()
            syn[f]=(L[-1] if L else "?")[:150]
A["syntax"]=syn
json.dump(A,open(OUT,"w",encoding="utf-8"),ensure_ascii=False,indent=1)
print("WROTE",OUT,os.path.getsize(OUT),"bytes; units",len(units),"scripts",len(scripts),"data",len(data),"syntax_err",len(syn))
