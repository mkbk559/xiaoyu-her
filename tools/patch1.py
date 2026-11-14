import os, shutil, time, json
H='/opt/her'
NL=chr(10)
ts=time.strftime('%Y%m%d-%H%M%S')
def rd(f): return open(H+'/'+f,encoding='utf-8').read()
def wr(f,s): open(H+'/'+f,'w',encoding='utf-8').write(s)
def bk(f):
    p=H+'/'+f; b=p+'.pre-unify-'+ts; shutil.copy2(p,b); print('BACKUP',b)

# ============ 1. plan.mjs 加 code 字段 ============
bk('plan.mjs')
src=rd('plan.mjs')
codes=['sleep','wake','work','eat','work2','out','evening','rest','novel','rest']
out=[]; ci=0
for line in src.split(NL):
    s=line.lstrip()
    if s.startswith("{ from: '") and s.endswith('},'):
        i=line.find(", kind: '")
        if i>0:
            line=line[:i]+", code: '"+codes[ci]+"'"+line[i:]
            ci+=1
    out.append(line)
assert ci==10, 'plan slots code count '+str(ci)
wr('plan.mjs', NL.join(out))
print('plan.mjs OK, slots=',ci)

# ============ 2. her-world.mjs 日程从 plan 派生 ============
bk('her-world.mjs')
src=rd('her-world.mjs'); lines=src.split(NL)
st=None
for i,l in enumerate(lines):
    if 'export const SCHEDULE = [' in l: st=i; break
end=None
for j in range(st,len(lines)):
    if lines[j].strip()==']': end=j; break
start=st
if start>0 and '3. 日程' in lines[start-1]: start=st-1
new=[
"/* ===== 3. 日程（单一来源：/opt/her/plan.mjs，2026-11-11 统一） ===== */",
"import { SLOTS as PLAN_SLOTS } from '/opt/her/plan.mjs'",
"const toHour = hhmm => { const a = hhmm.split(':'); return Number(a[0]) + Number(a[1]) / 60 }",
"export const SCHEDULE = PLAN_SLOTS.map(s => ({",
"  from: toHour(s.from), to: toHour(s.to), kind: s.code || s.kind, label: s.label,",
"  learn: Boolean(s.learn), content: Boolean(s.content), quiet: Boolean(s.quiet),",
"}))",
]
lines[start:end+1]=new
src=NL.join(lines)
# 测试钩子：HER_FAKE_HOUR 可伪造小时（默认不生效）
old="  const h = d.getUTCHours() + d.getUTCMinutes() / 60"
assert old in src
new2=("  const hRaw = d.getUTCHours() + d.getUTCMinutes() / 60"+NL+
      "  const fh = process.env.HER_FAKE_HOUR"+NL+
      "  const h = (fh && Number.isFinite(Number(fh))) ? Number(fh) : hRaw")
src=src.replace(old,new2,1)
wr('her-world.mjs',src)
print('her-world.mjs OK, schedule lines=',len(new))

# ============ 3. her-mind.mjs 学习接进内核 ============
bk('her-mind.mjs')
src=rd('her-mind.mjs')
a="import { worldBrief, rhythmFactor, timeContext, currentSlot } from '/opt/her/her-world.mjs'"
assert a in src
src=src.replace(a, a+NL+"import { QUOTAS as PLAN_QUOTAS } from '/opt/her/plan.mjs'",1)

anchor="function pickGoal(m) {"
assert anchor in src
helpers=(
"function countLearned() {"+NL+
"  try { return readFileSync(HOME + '/self-learn.jsonl', 'utf8').split(String.fromCharCode(10)).filter(Boolean).length } catch { return 0 }"+NL+
"}"+NL+NL+
"function learnCountToday(m) {"+NL+
"  return (m.today.did || []).filter(d => d.goal === 'learn' && d.ok).length"+NL+
"}"+NL+NL+
"function learnPick(m) {"+NL+
"  try {"+NL+
"    const slot = currentSlot()"+NL+
"    if (!slot || !slot.learn) return null"+NL+
"    const cap = Number(PLAN_QUOTAS.learnSessions) || 3"+NL+
"    if (learnCountToday(m) >= cap) return null"+NL+
"    return { goal: { id: 'learn', kind: 'skill', title: '学点东西（自己找，学完记我怎么用）', desire: 0.5 }, score: 0.01 }"+NL+
"  } catch { return null }"+NL+
"}"+NL+NL
)
src=src.replace(anchor, helpers+anchor,1)

old="  scores.sort((a, b) => b.score - a.score)"+NL+"  return scores[0] || null"
assert old in src
src=src.replace(old,"  scores.sort((a, b) => b.score - a.score)"+NL+"  return scores[0] || learnPick(m)",1)

old="  const g = pick.goal"+NL+"  if (pick.isPromise) return [{ act: 'fulfill', what: g.title }]"
assert old in src
src=src.replace(old,"  const g = pick.goal"+NL+"  if (g.id === 'learn') return [{ act: 'learn', what: '学一轮（自己找课，学完记我怎么用）' }]"+NL+"  if (pick.isPromise) return [{ act: 'fulfill', what: g.title }]",1)

old="    } else {"+NL+"      out.note = '这一步不需要真执行'"
assert old in src
src=src.replace(old,"    } else if (step.act === 'learn') {"+NL+"      const r = runScript('self-learn.mjs', 900000, { HER_DAY_LIMIT: '3000', HER_HOUR_LIMIT: '1500' })"+NL+"      Object.assign(out, r)"+NL+"    } else {"+NL+"      out.note = '这一步不需要真执行'",1)

old="  // ④ 执行"
assert old in src
src=src.replace(old,"  // ④ 执行"+NL+"  const learnBefore = countLearned()",1)
old="  const realGain = novelGain > 0 || videoGain > 0"
assert old in src
src=src.replace(old,"  const learnGain = Math.max(0, countLearned() - learnBefore)"+NL+"  const realGain = novelGain > 0 || videoGain > 0 || learnGain > 0",1)
wr('her-mind.mjs',src)
print('her-mind.mjs OK')
