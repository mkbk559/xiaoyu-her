import shutil, time
NL=chr(10)
def rd(p): return open(p,encoding='utf-8').read()
def wr(p,s): open(p,'w',encoding='utf-8').write(s)
def bk(p): shutil.copy2(p,p+'.pre-cap-'+time.strftime('%Y%m%d-%H%M%S'))

# 1) plan.mjs：日上限进 QUOTAS（单一来源）
P='/opt/her/plan.mjs'; bk(P); s=rd(P)
a="  learnSessions: 3,    // 学习提到 3 轮——学的是\"怎么做内容\"，不是\"怎么接单\""
assert a in s
s=s.replace(a, a+NL+"  proactiveMaxPerDay: 4, // 主动开口日上限（桥与内核都读这一条）",1)
wr(P,s); print('plan.mjs + proactiveMaxPerDay')

# 2) bridge：上限改读 plan.mjs（两边同一个数）
G='/opt/herqq/bridge.mjs'; bk(G); s=rd(G)
a="const PROACTIVE_MAX_PER_DAY = 4             // 一天最多主动 4 次"
assert a in s
s=s.replace(a,"import { QUOTAS as PLAN_QUOTAS } from '/opt/her/plan.mjs'"+NL+
              "const PROACTIVE_MAX_PER_DAY = Number(PLAN_QUOTAS.proactiveMaxPerDay) || 4   // 单一来源：plan.mjs",1)
wr(G,s); print('bridge cap from plan.mjs')

# 3) her-mind：reach 也遵守同一个上限（不再只看 ===0）
M='/opt/her/her-mind.mjs'; bk(M); s=rd(M)
a="    if (!done('reach') && q.proactiveToday === 0 && q.hoursSinceProactive >= 3) {"
assert a in s
s=s.replace(a,"    const reachCap = Number(PLAN_QUOTAS.proactiveMaxPerDay) || 4"+NL+
              "    if (!done('reach') && q.proactiveToday < reachCap && q.hoursSinceProactive >= 3) {",1)
wr(M,s); print('her-mind reach respects cap')
