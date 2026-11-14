import os
H="/opt/her"
files=[]
for d in [H,"/opt/herqq"]:
    for f in os.listdir(d):
        p=os.path.join(d,f)
        if os.path.isfile(p) and f.endswith((".mjs",".py",".sh")):
            files.append(p)
KWS=["knowledge","怎么说话","her-graph","graphRecall","recall(","her-consume","consume(","her-goals","skills.jsonl","self-learn","her-veto","her-ledger","learn-batch","learn-todo"]
for kw in KWS:
    print("#####",kw)
    for p in files:
        try: txt=open(p,encoding="utf-8",errors="ignore").read()
        except Exception: continue
        if kw in txt:
            hits=[(i,l.strip()) for i,l in enumerate(txt.splitlines(),1) if kw in l]
            print(" ",os.path.basename(p),"(%d hits)"%len(hits))
            for i,l in hits[:3]: print("    %4d %s"%(i,l[:140]))
