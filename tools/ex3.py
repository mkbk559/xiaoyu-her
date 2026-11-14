import os,subprocess
H="/opt/her"
def sh(c): return subprocess.run(["bash","-lc",c],capture_output=True,text=True).stdout
print("== her-mind.mjs 尾部 60 行 ==")
L=open(H+"/her-mind.mjs",encoding="utf-8").read().splitlines()
for i,x in enumerate(L[-60:],len(L)-59): print("  %4d %s"%(i,x[:150]))
print()
print("== IS_DRY / ACTIONABLE / defaultMind 片段 ==")
for i,l in enumerate(L,1):
    if any(k in l for k in ["IS_DRY","ACTIONABLE","defaultMind","import ","goals:","id: '"]):
        print("  %4d %s"%(i,l[:150]))
print()
print("== slot.kind 用法 ==")
print(sh("grep -rn \"slot.kind\|kind === '\|WORK_SLOTS\" /opt/her/*.mjs /opt/herqq/*.mjs 2>/dev/null | head -25"))
print()
print("== self-learn.mjs 头部与输出 ==")
print(open(H+"/self-learn.mjs",encoding="utf-8").read()[:1800])
