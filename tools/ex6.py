H="/opt/her"
W=open(H+"/her-world.mjs",encoding="utf-8").read().splitlines()
print("== her-world 30-95 ==")
for i,x in enumerate(W[29:95],30): print("%4d %s"%(i,x[:160]))
M=open(H+"/her-mind.mjs",encoding="utf-8").read().splitlines()
print("== her-mind 230-262 ==")
for i,x in enumerate(M[229:262],230): print("%4d %s"%(i,x[:160]))
print("== her-mind 500-560 ==")
for i,x in enumerate(M[499:560],500): print("%4d %s"%(i,x[:160]))
