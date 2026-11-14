import shutil, time
NL=chr(10)
def rd(p): return open(p,encoding='utf-8').read()
def wr(p,s): open(p,'w',encoding='utf-8').write(s)
def bk(p):
    b=p+'.pre-relation-'+time.strftime('%Y%m%d-%H%M%S'); shutil.copy2(p,b); print('BACKUP',b)

M='/opt/her/her-mind.mjs'
bk(M); src=rd(M)

a="import { QUOTAS as PLAN_QUOTAS } from '/opt/her/plan.mjs'"
assert a in src
src=src.replace(a, a+NL+"import { quickRelation, brief as relationBrief, pushProactiveRequest } from '/opt/her/her-relationship.mjs'",1)

a="function pickGoal(m) {"
assert a in src
rel=(
"/* 关系动作（2026-11-11，B 为主）：有由头才开口，不打卡。 */"+NL+
"function relationHook(kind, q) {"+NL+
"  try {"+NL+
"    const s = JSON.parse(readFileSync(HOME + '/her-soul.json', 'utf8'))"+NL+
"    const parts = []"+NL+
"    if (kind === 'maintain') {"+NL+
"      const p = (s.pending || []).filter(x => x.kind === 'promise' || x.kind === 'promise-keep')"+NL+
"      if (p.length) parts.push('你还欠着一句：' + String(p[0].what || '').slice(0, 40))"+NL+
"      parts.push('接着上次没说完的话头')"+NL+
"    }"+NL+
"    const d = (s.desires || [])[0]"+NL+
"    if (d && (d.text || d.what)) parts.push('你此刻惦记着：' + String(d.text || d.what).slice(0, 30))"+NL+
"    if (!parts.length) parts.push('没什么特别由头，就说你此刻在干什么、刚想到什么')"+NL+
"    return parts.join('；')"+NL+
"  } catch { return '就说你此刻在干什么' }"+NL+
"}"+NL+NL+
"function relationPick(m) {"+NL+
"  try {"+NL+
"    const h = timeContext().hour"+NL+
"    if (h < 9 || h >= 23) return null"+NL+
"    const q = quickRelation()"+NL+
"    const today = stamp().slice(0, 10)"+NL+
"    const did = (m.today && m.today.did ? m.today.did : []).filter(d => String(d.at || '').slice(0, 10) === today)"+NL+
"    const done = id => did.some(d => d.goal === id && d.ok)"+NL+
"    const pending = (m.pending || [])"+NL+
"    if (!done('maintain') && (pending.length ? q.hoursSinceUser >= 8 : q.hoursSinceUser >= 36)) {"+NL+
"      return { goal: { id: 'maintain', kind: 'relation', title: '接着上次跟他说两句', desire: 0.9 }, score: 999 }"+NL+
"    }"+NL+
"    if (!done('reach') && q.proactiveToday === 0 && q.hoursSinceProactive >= 3) {"+NL+
"      return { goal: { id: 'reach', kind: 'relation', title: '找个由头跟他说一句', desire: 0.85 }, score: 998 }"+NL+
"    }"+NL+
"    return null"+NL+
"  } catch { return null }"+NL+
"}"+NL+NL
)
src=src.replace(a, rel+a,1)

a="  const pick = pickGoal(m)"
assert a in src
src=src.replace(a,"  const pick = relationPick(m) || pickGoal(m)",1)

a="  const rounds = checkRounds(pick.goal)"
assert a in src
src=src.replace(a,"  const rounds = pick.goal.kind === 'relation' ? { ok: true } : checkRounds(pick.goal)",1)

a="  if (g.id === 'learn') return [{ act: 'learn', what: '学一轮（自己找课，学完记我怎么用）' }]"
assert a in src
src=src.replace(a, a+NL+"  if (g.id === 'reach') return [{ act: 'reach', what: '找个由头跟他说一句' }]"+NL+"  if (g.id === 'maintain') return [{ act: 'maintain', what: '接着上次的话头跟他聊' }]",1)

a="    } else if (step.act === 'learn') {"
assert a in src
src=src.replace(a,(
"    } else if (step.act === 'reach' || step.act === 'maintain') {"+NL+
"      const q = quickRelation()"+NL+
"      const hook = relationHook(step.act, q)"+NL+
"      const okq = pushProactiveRequest({ kind: step.act, hook, why: step.what })"+NL+
"      out.ok = okq"+NL+
"      out.note = okq ? '已交给桥接（由它按 40 分钟/4 条护栏开口）' : '入队失败'"+NL+
"    } else if (step.act === 'learn') {"),1)

a="  if (!dryRun && !realGain && !result.skipped) result.ok = false"
assert a in src
src=src.replace(a,(
"  const relationAct = Boolean(plan[0] && (plan[0].act === 'reach' || plan[0].act === 'maintain'))"+NL+
"  if (!dryRun && !realGain && !result.skipped && !relationAct) result.ok = false"),1)

a="  parts.push('说话：不说「一定」「肯定」，说「大概」；允许烦和累；长度别都一样；说具体的事；留一半让人推')"
assert a in src
src=src.replace(a, a+NL+"  try { parts.push('你们最近：' + relationBrief()) } catch { }",1)
wr(M,src)
print('her-mind patched')

B='/opt/herqq/bridge.mjs'
bk(B); src=rd(B)

a="const PROACTIVE_LOG = '/opt/her/her-proactive.jsonl'   // 护栏 3：记录主动消息与回复"
assert a in src
src=src.replace(a, a+NL+"const PROACTIVE_QUEUE = '/opt/her/her-proactive-queue.jsonl'   // 内核关系动作→桥投递",1)

a="/** 主动开口检查 */"
assert a in src
helpers=(
"/* 关系动作队列（2026-11-11，B 为主）：内核决定\"该找他说了\"，桥负责投递。 */"+NL+
"function peekQueue() {"+NL+
"  try {"+NL+
"    if (!existsSync(PROACTIVE_QUEUE)) return null"+NL+
"    const lines = readFileSync(PROACTIVE_QUEUE, 'utf8').split(String.fromCharCode(10)).filter(Boolean)"+NL+
"    if (!lines.length) return null"+NL+
"    try { return JSON.parse(lines[0]) } catch { return null }"+NL+
"  } catch { return null }"+NL+
"}"+NL+
"function dropQueue() {"+NL+
"  try {"+NL+
"    if (!existsSync(PROACTIVE_QUEUE)) return"+NL+
"    const lines = readFileSync(PROACTIVE_QUEUE, 'utf8').split(String.fromCharCode(10)).filter(Boolean)"+NL+
"    writeFileSync(PROACTIVE_QUEUE, lines.slice(1).join(String.fromCharCode(10)) + (lines.length > 1 ? String.fromCharCode(10) : ''))"+NL+
"  } catch { }"+NL+
"}"+NL+NL
)
src=src.replace(a, helpers+a,1)

a="    const recent = recentProactiveTexts(3)"
assert a in src
src=src.replace(a, "    const queueReq = peekQueue()"+NL+"    const hookHint = queueReq && queueReq.hook ? ('" + chr(92)+"n（你今天心里有个由头：' + queueReq.hook + '。就用它开口。）') : ''"+NL+"    const recent = recentProactiveTexts(3)",1)

a="+ recentHint + '" + chr(92)+"n' +"
assert a in src
src=src.replace(a, "+ recentHint + hookHint + '" + chr(92)+"n' +",1)

a="    proactiveCountToday++"
assert src.count(a)==1, src.count(a)
src=src.replace(a, "    proactiveCountToday++"+NL+"    dropQueue()",1)
wr(B,src)
print('bridge patched')
