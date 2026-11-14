import os,json
H="/opt/her"
L=open(H+"/her-world.mjs",encoding="utf-8").read().splitlines()
print("== her-world.mjs 95-125 ==")
for i,x in enumerate(L[94:125],95): print("  %4d %s"%(i,x[:150]))
M=open(H+"/her-mind.mjs",encoding="utf-8").read().splitlines()
def block(name,maxl=60):
    for i,l in enumerate(M):
        if "function "+name+"(" in l:
            print("---- her-mind %s (line %d)"%(name,i+1))
            for x in M[i:i+maxl]:
                print("  ",x[:150])
            print()
            return
for n in ["pickGoal","makePlan","doAct","tick"]: block(n)
print("== her-mind: 学习/learn 相关行 ==")
for i,l in enumerate(M,1):
    if "learn" in l.lower() or "学习" in l:
        print("  %4d %s"%(i,l.strip()[:150]))
print()
print("== her-mind.json today 摘要 ==")
d=json.load(open(H+"/her-mind.json"))
t=d.get("today",{})
print("date",t.get("date"),"did count",len(t.get("did",[])))
for e in t.get("did",[])[-12:]:
    print("   ",json.dumps(e,ensure_ascii=False)[:200])
print("counters:",{k:v for k,v in t.items() if k!="did"})
print("steps:",d.get("steps"),"pending:",d.get("pending"))
print("goals:",[ (g.get("id"),g.get("current"),g.get("target")) for g in d.get("goals",[])])
