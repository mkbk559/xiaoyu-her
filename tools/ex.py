import os,json
H="/opt/her"
def show(f, names, maxl=70):
    p=os.path.join(H,f)
    lines=open(p,encoding="utf-8",errors="ignore").read().splitlines()
    for nm in names:
        for i,l in enumerate(lines):
            if ("function "+nm+"(" in l) or ("function "+nm+" (") in l:
                print("---- %s :: %s (line %d)"%(f,nm,i+1))
                for x in lines[i:i+maxl]:
                    print("  ",x[:150])
                    if x.strip()=="}" and x.startswith("}"): break
                print()
                break
print("######## plan.mjs 全文")
print(open(H+"/plan.mjs",encoding="utf-8").read()[:4600])
print()
print("######## her-world.mjs SCHEDULE")
for i,l in enumerate(open(H+"/her-world.mjs",encoding="utf-8").read().splitlines(),1):
    if "SCHEDULE" in l or "slot" in l.lower():
        print("  %4d %s"%(i,l[:150]))
