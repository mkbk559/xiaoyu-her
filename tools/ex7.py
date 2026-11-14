H="/opt/her"
M=open(H+"/her-mind.mjs",encoding="utf-8").read().splitlines()
print("== her-mind 160-215 ==")
for i,x in enumerate(M[159:215],160): print("%4d %s"%(i,x[:160]))
