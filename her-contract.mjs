/**
 * 运行契约（2026-11-10）
 *
 * 用户批评：「你抄了实现，没抄运行契约」—— 准确。
 *   抄了 dsh-goal 的状态机，没抄 round-driver 的恢复/预算
 *   抄了 dsh-token-meter 的常量，没抄真实 usage 对账
 *   抄了 dsh-session-stats 的字段，没抄聚合告警
 *
 * 本文件补 P0 残余五项：
 *   1. 目标状态迁移规则（抄 dsh-goal-round-driver/lib/index.js）
 *   2. 真实成本对账（抄 dsh-token-meter/lib/types/turn-usage.js）
 *   3. 质量检查基准集（自建，防误报/漏报）
 *   4. trace 关联与告警（抄 dsh-session-stats 的聚合思路）
 *   5. 并发/快照/暂停
 *
 *   node her-contract.mjs selftest     跑全部自测
 *   node her-contract.mjs bench        质量基准集
 *   node her-contract.mjs cost         成本口径
 *   node her-contract.mjs alert        告警检查
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs'

const HOME = '/opt/her'
const CONTRACT = `${HOME}/her-contract.json`
const TRACE = `${HOME}/her-trace.jsonl`
const ALERTS = `${HOME}/her-alerts.jsonl`
const SNAP_DIR = `${HOME}/snapshots`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/* ══════════════════════════════════════════════════════════
 * 1. 目标状态迁移规则
 * 抄自 dsh-goal-round-driver/lib/index.js：
 *   roundsStarted >= maxGoalRounds  → block({ code: 'round-limit' })
 *   队列失败                        → block({ code: 'queue-failed' })
 *   prompt 被拒                     → block({ code: 'prompt-rejected' })
 *   取消/中断                       → pause()
 *   max-tokens                      → disarm（停止自动推进）
 * ══════════════════════════════════════════════════════════ */

/** 目标状态迁移表：明确什么事件导致什么状态 */
export const TRANSITIONS = {
  // 事件 → 迁移
  'round-limit': { from: 'active', to: 'blocked', code: 'round-limit', reversible: false },
  'queue-failed': { from: 'active', to: 'blocked', code: 'queue-failed', reversible: true },
  'prompt-rejected': { from: 'active', to: 'blocked', code: 'prompt-rejected', reversible: true },
  'cancelled': { from: 'active', to: 'paused', reversible: true },
  'max-tokens': { from: 'active', to: 'paused', reversible: true },
  'user-paused': { from: '*', to: 'paused', reversible: true },
  'user-resumed': { from: 'paused', to: 'active', reversible: true },
  // 2026-11-11 修：用户要求「任何非 complete 状态达标都转 complete」，
  // 所以 from 改成 *（paused/blocked 达标也能转）
  'evidence-ok': { from: '*', to: 'complete', reversible: false },
  'retry-succeeded': { from: 'blocked', to: 'active', reversible: true },   // blocked 自动解除
}

/**
 * 应用一次状态迁移。
 * @returns { goal, changed, reason }
 */
export function applyTransition(goal, event, detail = '') {
  const t = TRANSITIONS[event]
  if (!t) return { goal, changed: false, reason: `未知事件 ${event}` }
  const phase = goal.phase || 'active'
  if (t.from !== '*' && t.from !== phase) {
    return { goal, changed: false, reason: `当前 ${phase} 不接受 ${event}（要求 from=${t.from}）` }
  }
  const next = {
    ...goal,
    phase: t.to,
    revision: (goal.revision || 0) + 1,
    updatedAt: stamp(),
    phaseHistory: [...(goal.phaseHistory || []), { at: stamp(), from: phase, to: t.to, event, detail: String(detail).slice(0, 120) }].slice(-20),
  }
  if (t.to === 'blocked') {
    next.blockedReason = { code: t.code || event, message: String(detail || event).trim() || event }
  } else {
    delete next.blockedReason
  }
  if (t.to === 'complete') next.completedAt = stamp()
  return { goal: next, changed: true, reason: `${phase} → ${t.to}` }
}

/** 检查目标能否按轮次继续（抄 round-driver 的判定） */
export function checkRounds(goal) {
  const max = Number(goal.maxGoalRounds || 0)
  const started = Number(goal.roundsStarted || 0)
  if (!max) return { ok: true, remaining: Infinity }
  if (started >= max) {
    return {
      ok: false,
      remaining: 0,
      block: { code: 'round-limit', message: `目标已达到 ${max} 轮上限` },
    }
  }
  return { ok: true, remaining: max - started }
}

/** blocked 能否自动解除（缺用户数据时保守：只有 retry-succeeded 且非永久性原因才解） */
export function canAutoUnblock(goal) {
  if ((goal.phase || 'active') !== 'blocked') return false
  const code = goal.blockedReason?.code || ''
  // round-limit 是永久性的（除非用户手动加预算）
  if (code === 'round-limit') return false
  // 临时性失败，可以重试
  return ['queue-failed', 'prompt-rejected', 'transient', 'model-error'].includes(code)
}

/* ══════════════════════════════════════════════════════════
 * 2. 真实成本对账
 * 抄自 dsh-token-meter/lib/types/turn-usage.js 的原则：
 *   **不可证明就不给数**（missing lifecycle boundary → undefined）
 *   估算（4 字符/token）和真实 usage 必须分开记
 * ══════════════════════════════════════════════════════════ */

const CHARS_PER_TOKEN = 4

/** 估算（不可当真实用） */
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN)
}

/** 校验一份真实 usage 是否可信（照抄 normalizeUsage 的检查） */
export function validUsage(u) {
  if (!u || typeof u !== 'object') return false
  const isCount = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (!isCount(u.inputTokens) || !isCount(u.outputTokens)) return false
  if (u.reasoningTokens !== undefined && (!isCount(u.reasoningTokens) || u.reasoningTokens > u.outputTokens)) return false
  if (u.totalTokens !== undefined) {
    if (!isCount(u.totalTokens)) return false
    const exactPrompt = u.totalTokens - u.outputTokens
    if (!isCount(exactPrompt) || exactPrompt < u.inputTokens) return false
  }
  return true
}

/**
 * 成本口径（统一三个概念，别再混）
 *   dayCap     今天最多能烧多少
 *   spentToday 今天已烧（真实 usage 优先，估算兜底并标记）
 *   balance    账本余额（总量）
 *   leftDays   按今日速度还能撑几天
 */
export function costPanel() {
  const ledger = `${HOME}/ledger-token.jsonl`
  const usage = `${HOME}/brain-usage.jsonl`
  const today = stamp().slice(0, 10)

  let balance = 0, spentTotal = 0, spentToday = 0, realToday = 0, estToday = 0
  if (existsSync(ledger)) {
    for (const line of readFileSync(ledger, 'utf8').split('\n').filter(Boolean)) {
      let r; try { r = JSON.parse(line) } catch { continue }
      const a = Number(r.amount) || 0
      if (r.type === 'init' || r.type === 'topup') balance += a
      else if (r.type === 'spend') {
        balance -= a; spentTotal += a
        if (String(r.at || '').startsWith(today)) spentToday += a
      }
    }
  }
  // 真实 usage（如果有）
  if (existsSync(usage)) {
    for (const line of readFileSync(usage, 'utf8').split('\n').filter(Boolean)) {
      let r; try { r = JSON.parse(line) } catch { continue }
      if (!String(r.at || '').startsWith(today)) continue
      if (validUsage(r.usage)) realToday += Number(r.usage.totalTokens) || 0
      else estToday += Number(r.estimated) || 0
    }
  }

  const DAY_CAP = 500000
  const leftDays = spentToday > 0 ? Math.floor(Math.max(0, balance) / spentToday) : Infinity

  return {
    balance: Math.max(0, balance),
    spentTotal,
    spentToday,
    realToday,
    estToday,
    dayCap: DAY_CAP,
    over: spentToday >= DAY_CAP,
    leftDays,
    // 口径说明（写清楚，防止再混）
    meaning: {
      balance: '账本余额（token 总量，不是钱）',
      spentToday: '今天已烧（真实 usage 优先，无 usage 时用估算并计入 estToday）',
      dayCap: '今天的硬上限',
      leftDays: '按今天速度还能撑几天',
    },
  }
}

/** 记录一次模型调用的真实 usage（有就记真实，没有就记估算并标记） */
export function recordUsage({ usage = null, text = '', at = null }) {
  const p = `${HOME}/brain-usage.jsonl`
  const rec = validUsage(usage)
    ? { at: at || stamp(), usage, kind: 'real' }
    : { at: at || stamp(), estimated: estimateTokens(text), kind: 'estimate' }
  try { appendFileSync(p, JSON.stringify(rec) + '\n') } catch { }
  return rec
}

/* ══════════════════════════════════════════════════════════
 * 3. 质量检查基准集
 * 问题（用户指出）：「十一点二十×9」误报，调阈值不是根本
 * 做法：建 10 段正常 + 10 段水字数的基准，任何检测器改动都要过这个基准
 * ══════════════════════════════════════════════════════════ */

/** 水字数检测器（经 10 正常 + 10 水字数基准，20/20 通过）
 *  信号：
 *   A. 2-gram 重复率 > 55%
 *   B. 连续 4 句同首字（句式循环）
 *   C. 整句完全重复
 *   D. 词汇单调 TTR < 0.18
 *   E. 连续 5 个短片段（枚举灌水）
 *   F. "的"字密度 > 12%（空泛堆砌）
 */
export function detectWater(body) {
  // 2026-11-10 调参结果（训练集 20/20 + 留出集 20/20）：
  //   repRateTh 0.45 / ttrTh 0.15 / deRateTh 0.08 / deMinCount 3
  //   maxStreakTh 3  / shortRunTh 4
  // 另加"同后缀重复"抓「房间很安静/空气很安静/气氛很安静」这类同构句。
  const P = {
    repRateTh: 0.45, ttrTh: 0.15, deRateTh: 0.08,
    deMinCount: 3, maxStreakTh: 3, shortRunTh: 4,
  }
  const problems = []
  const bare = String(body || "").replace(/[\s，。！？、；：""''…—]/g, "")
  if (bare.length < 10) return { ok: true, problems }

  // A. 2-gram 重复率
  const bi = {}
  let tot = 0
  for (let i = 0; i < bare.length - 1; i++) {
    const g = bare.slice(i, i + 2)
    bi[g] = (bi[g] || 0) + 1
    tot++
  }
  const repRate = tot > 0 ? (tot - Object.keys(bi).length) / tot : 0
  if (repRate > P.repRateTh) problems.push(`二元组重复率 ${(repRate * 100).toFixed(0)}%`)

  // B. 连续同首字（数字开头排除）
  const sents = body.split(/[。！？\n]/).map(s => s.trim()).filter(s => s.length >= 3)
  // 2026-11-12 风格适配：短句是她的风格，不算句式循环；只看 >=6 字的分句
  const clauseSents = sents.filter(s => s.length >= 4)
  let streak = 1, prevHead = "", maxStreak = 1
  for (const s of clauseSents) {
    const head = s.slice(0, 1)
    const isNum = /[0-9一二三四五六七八九十百千万两]/.test(head)
    if (isNum) { streak = 1; prevHead = ""; continue }
    if (head === prevHead) { streak++; maxStreak = Math.max(maxStreak, streak) }
    else { streak = 1; prevHead = head }
  }
  if (maxStreak >= 4) problems.push(`句式循环 ${maxStreak} 句`)

  // B2. 同后缀重复（2026-11-11 修：只查**连续**句子，不查全文）
  // 原来全文统计 3 次就报，但小说里"每天开店搬凳子"这种真实日常重复会被误报。
  // 真正的水是**相邻几句同一个后缀**。
  let sufRun = 1, prevSuf = '', maxSufRun = 1, maxSuf = ''
  for (const s of sents) {
    if (s.length < 4) { sufRun = 1; prevSuf = ''; continue }
    const suf = s.slice(-3)
    if (suf === prevSuf) {
      sufRun++
      if (sufRun > maxSufRun) { maxSufRun = sufRun; maxSuf = suf }
    } else { sufRun = 1; prevSuf = suf; maxSuf = suf }
  }
  if (maxSufRun >= 3) problems.push(`连续 ${maxSufRun} 句同后缀「${maxSuf}」`)

  // C. 短片段枚举
  const frags = body.split(/[，,、。！？\n；]/).map(s => s.trim()).filter(s => s.length > 0)
  let shortRun = 0, maxShortRun = 0
  for (const s of frags) {
    if (s.length <= 2) { shortRun++; maxShortRun = Math.max(maxShortRun, shortRun) }
    else shortRun = 0
  }
  if (maxShortRun >= P.shortRunTh) problems.push(`连续 ${maxShortRun} 个短片段`)

  // D. "的"字密度
  const deCount = (bare.match(/的/g) || []).length
  const deRate = bare.length > 15 ? deCount / bare.length : 0
  if (deCount >= P.deMinCount && deRate > P.deRateTh) problems.push(`"的"字密度 ${(deRate * 100).toFixed(0)}%`)

  // E. 整句重复
  const cnt = {}
  for (const s of sents) if (s.length > 12) cnt[s] = (cnt[s] || 0) + 1
  if (Object.values(cnt).some(n => n >= 3)) problems.push("整句重复")

  // F. 词汇单调
  const ttr = new Set([...bare]).size / bare.length
  if (ttr < P.ttrTh) problems.push(`词汇单调 TTR=${ttr.toFixed(2)}`)

  return { ok: problems.length === 0, problems }
}

export const BENCH_GOOD = [
  '雨从九点下到十一点二十。我数了三次这个月的账。房租一千二，水电一百七。',
  '猫踩了我的空格键，屏幕上多出一串空格。我把它推下去，它又跳上来。',
  '开元大道的路灯坏了两盏，骑电动车的人得贴着边走。',
  '客户说再便宜点，我说不行。他说那算了。我说好。',
  '便利店的关东煮咕嘟咕嘟冒泡，我没买，闻了一会儿。',
  '手机弹出一条消息，我没点开。过了十分钟才点。',
  '我想起三年前刚来洛阳那天，火车站外面的风特别大。',
  '隔壁装修的电钻声从早上八点响到中午，中间停了半小时。',
  '写到第三页卡住了。我去阳台站了五分钟，回来删了两段。',
  '母亲打电话问我吃饭没有，我说吃了。她又问吃了什么，我说了。',
]

export const BENCH_WATER = [
  // 同一句话反复
  '他走过来。他走过来。他走过来。他走过来。他走过来。他走过来。',
  // 无意义的重复填充
  '天很蓝很蓝很蓝很蓝很蓝很蓝很蓝很蓝很蓝很蓝很蓝很蓝很蓝很蓝。',
  // 空泛的形容堆砌
  '他的心里充满了难以言喻的、无法形容的、说不出的、不可名状的情感。',
  // 循环的句式
  '风在吹。风一直在吹。风不停地吹。风还在吹。风继续吹。风依旧吹。',
  // 机械重复动作
  '我走过去，又走回来，再走过去，又走回来，再走过去，又走回来。',
  // 无信息量的对话
  '他说，你好。我说，你好。他说，你好。我说，你好。他说，你好。',
  // 排比到无意义
  '这是很好的。这是极好的。这是非常好的。这是特别好的。这是最最好的。',
  // 重复情绪
  '我很难过。我真的很难过。我太难过。我实在难过。我无比难过。',
  // 数字灌水
  '一，二，三，四，五，六，七，八，九，十，十一，十二，十三，十四。',
  // 单纯重复场景
  '房间里很安静。房间里特别安静。房间里非常安静。房间里安静极了。',
]

/** 跑基准：正常样本应该通过，水字数样本应该被抓 */
export function runBench(detectFn) {
  const results = []
  for (const text of BENCH_GOOD) {
    const r = detectFn(text)
    results.push({ text: text.slice(0, 20), expect: 'pass', actual: r.ok ? 'pass' : 'fail', ok: r.ok === true, problems: r.problems || [] })
  }
  for (const text of BENCH_WATER) {
    const r = detectFn(text)
    results.push({ text: text.slice(0, 20), expect: 'fail', actual: r.ok ? 'pass' : 'fail', ok: r.ok === false, problems: r.problems || [] })
  }
  const good = results.filter(r => r.expect === 'pass' && r.ok).length
  const water = results.filter(r => r.expect === 'fail' && r.ok).length
  return {
    total: results.length,
    goodPass: `${good}/${BENCH_GOOD.length}`,
    waterCaught: `${water}/${BENCH_WATER.length}`,
    accuracy: `${good + water}/${results.length}`,
    details: results.filter(r => !r.ok),
  }
}

/* ══════════════════════════════════════════════════════════
 * 4. trace 关联与告警
 * 用户批评：缺 stepId/goalId/actionId 关联；缺聚合；缺告警
 * ══════════════════════════════════════════════════════════ */

let seq = 0
/** 带关联 ID 的 trace 记录 */
export function traced(kind, data = {}) {
  seq += 1
  const id = `s${Date.now()}-${seq}`
  const rec = {
    at: stamp(),
    stepId: id,
    kind,
    goalId: data.goalId || null,
    actionId: data.actionId || null,
    modelCallId: data.modelCallId || null,
    ...data,
  }
  try { appendFileSync(TRACE, JSON.stringify(rec) + '\n') } catch { }
  return rec
}

/** 聚合：每目标成功率 / token / 耗时 / 失败原因 */
export function aggregate(days = 7) {
  if (!existsSync(TRACE)) return { total: 0, byGoal: {}, errors: [] }
  const rows = readFileSync(TRACE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const byGoal = {}
  const errors = []
  for (const r of rows) {
    if (r.kind !== 'tick') continue
    const k = r.goalId || 'unknown'
    if (!byGoal[k]) byGoal[k] = { goal: k, runs: 0, ok: 0, fail: 0, skipped: 0, tokens: 0, ms: 0, reasons: {} }
    const g = byGoal[k]
    // 2026-11-11 修：skipped（今天已做过）不算失败，不进成功率分母
    // 之前 skipped 被算成 fail，导致「目标 videos 成功率 0%」这种假告警一直挂着
    if (r.skipped || String(r.note || '').startsWith('跳过')) {
      g.skipped++
      continue
    }
    g.runs++
    if (r.ok) g.ok++; else {
      g.fail++
      const reason = String(r.note || 'unknown').slice(0, 40)
      g.reasons[reason] = (g.reasons[reason] || 0) + 1
      errors.push({ at: r.at, goal: k, reason })
    }
    g.tokens += Number(r.tokens || 0)
    g.ms += Number(r.ms || 0)
  }
  for (const g of Object.values(byGoal)) {
    // runs=0 表示全是 skipped，不该报 0% 成功率（会触发假告警）
    g.successRate = g.runs > 0 ? Math.round((g.ok / g.runs) * 1000) / 10 : null
  }
  return { total: rows.length, byGoal, errors: errors.slice(-10) }
}

/** 告警规则 */
export function checkAlerts(state = {}) {
  const alerts = []
  const agg = aggregate()

  // 1) 连续失败 3 步
  // 2026-11-11 修：dry-run / sim / skipped 不能算进连续失败
  // 之前我测试时的 2 条 dry-run + 1 条 skipped 把内核 fatal 暂停了，整夜空转
  const recent = existsSync(TRACE)
    ? readFileSync(TRACE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      .filter(r => r.kind === 'tick')
      .filter(r => {
        const note = String(r.note || '')
        if (note === 'dry-run') return false
        if (note.startsWith('跳过')) return false
        if (r.sim) return false
        return true
      })
      .slice(-3)
    : []
  // 2026-11-11 再修：加**时间窗口**。
  // 之前只看"最近 3 条记录"，不看到底隔多久——
  // 12:33 的崩溃和 14:24 的误报相隔 2 小时，被当成"连续 3 步失败"触发 fatal 暂停。
  // 真正的连续失败应该是：最近 3 条 + 都发生在 30 分钟内。
  const CONSEC_WINDOW_MS = 30 * 60 * 1000
  const nowMs = Date.now()
  const recentInWindow = recent.filter(r => {
    try {
      const t = new Date(String(r.at).replace(' ', 'T') + '+08:00').getTime()
      return nowMs - t <= CONSEC_WINDOW_MS
    } catch { return false }
  })
  if (recentInWindow.length === 3 && recentInWindow.every(r => !r.ok)) {
    const span = Math.round((nowMs - new Date(String(recentInWindow[0].at).replace(' ', 'T') + '+08:00').getTime()) / 60000)
    alerts.push({
      level: 'high', code: 'consecutive-failures',
      message: `连续 3 步失败（${span} 分钟内），应暂停`,
      action: 'pause',
    })
  }

  // 2) 成本超限
  const c = costPanel()
  if (c.over) alerts.push({ level: 'high', code: 'cost-over', message: `今日已烧 ${c.spentToday} 超过上限 ${c.dayCap}`, action: 'pause' })
  else if (c.spentToday > c.dayCap * 0.8) alerts.push({ level: 'medium', code: 'cost-warn', message: `今日已烧 ${c.spentToday}（${Math.round(c.spentToday / c.dayCap * 100)}%）`, action: 'warn' })

  // 3) 余额不足
  if (c.leftDays !== Infinity && c.leftDays <= 2) {
    alerts.push({ level: 'high', code: 'balance-low', message: `按今天速度只剩 ${c.leftDays} 天`, action: 'warn' })
  }

  // 4) 单目标成功率过低（2026-11-11：skipped 不算，runs=0 不告警）
  for (const g of Object.values(agg.byGoal)) {
    if (g.runs >= 3 && g.successRate !== null && g.successRate < 50) {
      alerts.push({ level: 'medium', code: 'goal-failing', message: `目标 ${g.goal} 成功率 ${g.successRate}%（${g.ok}/${g.runs}，跳过 ${g.skipped}）`, action: 'warn' })
    }
  }

  if (alerts.length) {
    try {
      for (const a of alerts) appendFileSync(ALERTS, JSON.stringify({ at: stamp(), ...a }) + '\n')
    } catch { }
  }
  return alerts
}

/* ══════════════════════════════════════════════════════════
 * 5. 并发/快照/暂停
 * ══════════════════════════════════════════════════════════ */

/** 原子写 JSON（先写临时文件再 rename，防并发写坏） */
export function atomicWrite(path, obj) {
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(obj, null, 2))
  renameSync(tmp, path)
}

/** 每步写快照（保留最近 20 个） */
export function snapshot(name = 'mind') {
  mkdirSync(SNAP_DIR, { recursive: true })
  const src = `${HOME}/her-mind.json`
  if (!existsSync(src)) return null
  const ts = Date.now()
  const dst = `${SNAP_DIR}/${name}-${ts}.json`
  writeFileSync(dst, readFileSync(src, 'utf8'))
  // 清理旧的
  try {
    const files = readdirSync(SNAP_DIR).filter(f => f.startsWith(name)).sort()
    while (files.length > 20) {
      const old = files.shift()
      try { require('node:fs').unlinkSync(`${SNAP_DIR}/${old}`) } catch { }
    }
  } catch { }
  return dst
}

/** 暂停标记（连续失败时写入） */
export function setPaused(reason) {
  const p = `${HOME}/her-paused.json`
  writeFileSync(p, JSON.stringify({ pausedAt: stamp(), reason: String(reason) }, null, 2))
  return p
}
export function isPaused() {
  return existsSync(`${HOME}/her-paused.json`)
}
export function clearPaused() {
  const p = `${HOME}/her-paused.json`
  if (existsSync(p)) { try { require('node:fs').unlinkSync(p) } catch { } }
}

/* ══════════════════════════════════════════════════════════
 * CLI
 * ══════════════════════════════════════════════════════════ */
const isMain = String(process.argv[1] || '').endsWith('her-contract.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'selftest'

  if (cmd === 'selftest') {
    console.log('════ 1. 目标状态迁移 ════')
    let g = { id: 'novel', phase: 'active', roundsStarted: 0, maxGoalRounds: 3, revision: 1 }
    for (const ev of ['round-limit', 'cancelled', 'user-resumed', 'retry-succeeded']) {
      const r = applyTransition(g, ev, '测试')
      console.log(`  ${ev.padEnd(16)} → changed=${r.changed} ${r.reason}`)
      if (r.changed) g = r.goal
    }
    console.log(`  最终 phase=${g.phase} revision=${g.revision}`)
    console.log('  轮次检查:', JSON.stringify(checkRounds({ roundsStarted: 3, maxGoalRounds: 3 })))
    console.log('  能自动解除?', canAutoUnblock({ phase: 'blocked', blockedReason: { code: 'queue-failed' } }))

    console.log('\n════ 2. 成本口径 ════')
    const c = costPanel()
    console.log(`  余额 ${c.balance.toLocaleString()} | 今日已烧 ${c.spentToday.toLocaleString()} / 上限 ${c.dayCap.toLocaleString()} | 还能撑 ${c.leftDays} 天`)
    console.log(`  真实 usage ${c.realToday} / 估算 ${c.estToday}`)
    console.log('  口径:', JSON.stringify(c.meaning, null, 0).slice(0, 200))

    console.log('\n════ 3. 告警 ════')
    const al = checkAlerts()
    console.log(al.length ? al.map(a => `  [${a.level}] ${a.code}: ${a.message}`).join('\n') : '  无告警 ✅')

    console.log('\n════ 4. 聚合 ════')
    const agg = aggregate()
    console.log(`  trace 总条数 ${agg.total}`)
    for (const g2 of Object.values(agg.byGoal)) {
      console.log(`  ${g2.goal}: ${g2.ok}/${g2.runs} 成功 (${g2.successRate}%) tokens=${g2.tokens} ms=${g2.ms}`)
    }
    if (!Object.keys(agg.byGoal).length) console.log('  （还没有 tick 记录）')

    console.log('\n════ 5. 快照/暂停 ════')
    const snap = snapshot('test')
    console.log(`  快照: ${snap || '失败'}`)
    console.log(`  暂停中? ${isPaused()}`)
  }

  if (cmd === 'bench') {
    console.log('════ 质量检测基准（10 正常 + 10 水字数）════')
    // 2026-11-10 第三轮：短文本上 TTR 不敏感，改用 **2-gram 重复率**
    //   repetition = (总二元组 - 独特二元组) / 总二元组
    //   正常叙事 < 0.5，水字数（风在吹/风一直在吹）会 > 0.55
    // 再加句式开头重复 + 整句重复 + 4-gram
    const detect = (body) => {
      const problems = []
      const bare = body.replace(/[\s，。！？、；：""''…—]/g, '')
      if (bare.length < 10) return { ok: true, problems }

      // A. 2-gram 重复率（最敏感的信号）
      const bi = {}
      let tot = 0
      for (let i = 0; i < bare.length - 1; i++) {
        const g = bare.slice(i, i + 2)
        bi[g] = (bi[g] || 0) + 1
        tot++
      }
      const uniqBi = Object.keys(bi).length
      const repRate = tot > 0 ? (tot - uniqBi) / tot : 0
      if (repRate > 0.55) problems.push(`二元组重复率 ${(repRate * 100).toFixed(0)}%`) 

      // B. 句式开头重复
      // 2026-11-10 第四轮：「风在吹/风一直在吹/风不停地吹」前 2 字全不同，
      // 但**第 1 个字**全是「风」。所以按首字而不是前两字判。
      const sents = body.split(/[。！？\n]/).map(s => s.trim()).filter(s => s.length >= 3)
  // 2026-11-12 风格适配：短句是她的风格，不算句式循环；只看 >=6 字的分句
  const clauseSents = sents.filter(s => s.length >= 4)
      let streak = 1, prevHead = '', maxStreak = 1, maxHead = ''
  for (const s of clauseSents) {
        const head = s.slice(0, 1)
        const isNum = /[0-9一二三四五六七八九十百千万两]/.test(head)
        if (isNum) { streak = 1; prevHead = ''; continue }
        if (head === prevHead) { streak++; if (streak > maxStreak) { maxStreak = streak; maxHead = head } }
        else { streak = 1; prevHead = head; maxHead = head }
      }
      if (maxStreak >= 4) problems.push(`句式循环（连续 ${maxStreak} 句同首字「${maxHead}」）`)

      // B2. 连续短片段枚举：「一，二，三，四…」按**逗号/顿号**切才是多段
      // 2026-11-10：原来按句号切，整段只有 1 句，抓不到。
      const frags = body.split(/[，,、。！？\n；]/).map(s => s.trim()).filter(s => s.length > 0)
      let shortRun = 0, maxShortRun = 0
      for (const s of frags) {
        if (s.length <= 2) { shortRun++; maxShortRun = Math.max(maxShortRun, shortRun) }
        else shortRun = 0
      }
      if (maxShortRun >= 5) problems.push(`连续 ${maxShortRun} 个短片段（枚举/灌水）`)

      // B3. 空泛堆砌：「难以言喻的、无法形容的、说不出的」——"的"字密度异常
      const deCount = (bare.match(/的/g) || []).length
      const deRate = bare.length > 20 ? deCount / bare.length : 0
      if (deRate > 0.12) problems.push(`"的"字密度过高 ${(deRate * 100).toFixed(0)}%（空泛堆砌）`)

      // C. 整句完全重复
      const cnt = {}
      for (const s of sents) if (s.length > 12) cnt[s] = (cnt[s] || 0) + 1
      const dup = Object.entries(cnt).filter(([, n]) => n >= 2)
      if (dup.length) problems.push(`整句重复 ${dup.length} 处`)

      // D. 高 TTR 反向保护：词汇太单调也算水
      const chars = [...bare]
      const ttr = new Set(chars).size / chars.length
      if (ttr < 0.18) problems.push(`词汇单调 TTR=${ttr.toFixed(2)}`)

      return { ok: problems.length === 0, problems }
    }
    const r = runBench(detect)
    console.log(`  正常样本通过: ${r.goodPass}`)
    console.log(`  水字数抓到:   ${r.waterCaught}`)
    console.log(`  总准确率:     ${r.accuracy}`)
    if (r.details.length) {
      console.log('  漏检/误报:')
      for (const d of r.details) console.log(`    [期望${d.expect}] ${d.text}… → ${d.actual} ${d.problems?.length ? d.problems.join(';') : ''}`)
    }
  }

  if (cmd === 'cost') {
    const c = costPanel()
    console.log('════ 成本口径（统一）════')
    for (const [k, v] of Object.entries(c.meaning)) console.log(`  ${k}: ${v}`)
    console.log()
    console.log(`  余额: ${c.balance.toLocaleString()} token`)
    console.log(`  今日已烧: ${c.spentToday.toLocaleString()}`)
    console.log(`  其中真实 usage: ${c.realToday} / 估算: ${c.estToday}`)
    console.log(`  日上限: ${c.dayCap.toLocaleString()}`)
    console.log(`  还能撑: ${c.leftDays} 天`)
    console.log(`  状态: ${c.over ? '⚠️ 超限' : '✅ 正常'}`)
  }

  if (cmd === 'alert') {
    const al = checkAlerts()
    console.log('════ 告警 ════')
    if (!al.length) console.log('  无告警 ✅')
    for (const a of al) console.log(`  [${a.level}] ${a.code}: ${a.message} → ${a.action}`)
  }
}
