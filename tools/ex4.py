H="/opt/her"
L=open(H+"/her-mind.mjs",encoding="utf-8").read().splitlines()
print("== her-mind 560-760 ==")
for i,x in enumerate(L[559:760],560): print("%4d %s"%(i,x[:160]))
