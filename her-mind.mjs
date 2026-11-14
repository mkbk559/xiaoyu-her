/**
 * 她的内核 her-mind.mjs（2026-11-10）
 *
 * 用户架构判断（照抄）：
 *   「你现在的系统是'有状态、有记忆、有主动性'的，
 *     但还不是'有目标、有经历、有关系、会反思'的。」
 *
 *   需求/情绪/关系/未完成事项
 *           ↓
 *         目标系统（总调度）
 *           ↓
 *     计划 → 行动 → 结果
 *           ↓
 *      反思/记忆巩固
 *           ↓
 *     更新自我叙事与关系
 *
 * 这个文件就是那个闭环。不是又加一个模块——
 * 它把已有的（AIJiYi 的情绪/记忆、真实产出、QQ 通道）串起来。
 *
 *   node her-mind.mjs state      看她此刻完整的内心
 *   node her-mind.mjs tick       走一步：感知→选目标→计划→执行→反思
 *   node her-mind.mjs context    生成"她该知道的自己"（喂给 AIJiYi）
 *   node her-mind.mjs reflect    手动触发一次反思
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs'
// 2026-11-10 从 DSH 插件抄来的（见 her-plugin-copy.mjs）：
//   dsh-token-meter   → estimateRequestTokens（不调模型先算成本）
//   dsh-goal          → isSelectable / roundsExhausted / blockedReason（目标状态机）
//   dsh-session-stats → emptyStats / addStepStat（可观测指标）
import {
  estimateRequestTokens, isSelectable, roundsExhausted, blockedReason,
  emptyStats, addStepStat,
} from '/opt/her/her-plugin-copy.mjs'
import {
  applyTransition, checkRounds, costPanel, traced as _traced, checkAlerts,
  snapshot, setPaused, isPaused, detectWater,
} from '/opt/her/her-contract.mjs'
import {
  learnRelation, generateDesires, setFocus, remember,
  attentionContext, resolveConflict, checkPersona, checkSafety,
  relationOf, consolidate,
} from '/opt/her/her-soul.mjs'
import {
  arbitrate, canRetry, noteRetry, clearRetries,
  pause as arbPause, isPausedNow, pausedInfo,
} from '/opt/her/her-arbiter.mjs'
import { notify, health } from '/opt/her/her-ops.mjs'
import { checkComplete } from '/opt/her/her-complete.mjs'
import { worldBrief, rhythmFactor, timeContext, currentSlot } from '/opt/her/her-world.mjs'
import { QUOTAS as PLAN_QUOTAS } from '/opt/her/plan.mjs'
import { quickRelation, brief as relationBrief, pushProactiveRequest } from '/opt/her/her-relationship.mjs'
import { overrideFor } from '/opt/her/her-experience.mjs'

const HOME = '/opt/her'
// 2026-11-11 修「测试污染生产」：
//   dryRun 时切到独立的 state/trace 文件，物理上不碰生产数据
const IS_DRY = process.argv.includes('--dry')
const MIND = IS_DRY ? `${HOME}/.dry-her-mind.json` : `${HOME}/her-mind.json`
const REFLECT_LOG = IS_DRY ? `${HOME}/.dry-her-reflections.jsonl` : `${HOME}/her-reflections.jsonl`
// dry-run 时 trace 写到独立文件（必须在 HOME/IS_DRY 之后定义）
const traced = IS_DRY
  ? (kind, data) => { try { appendFileSync(`${HOME}/.dry-her-trace.jsonl`, JSON.stringify({ at: stamp(), kind, dry: true, ...data }) + '\n') } catch { } }
  : _traced
// 模拟用：HOUR_OFFSET=+3 表示把当前时间往后推 3 小时（只影响"现在几点"的判断）
const HOUR_OFFSET = Number(process.env.HOUR_OFFSET || 0)
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000 + HOUR_OFFSET * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const today = () => stamp().slice(0, 10)
const hour = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + HOUR_OFFSET * 3600 * 1000)
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

/* ══════════ 1. 真实产出（唯一可信来源） ══════════ */
function scanNovel() {
  const dir = `${HOME}/novel/正文`
  if (!existsSync(dir)) return { chars: 0, files: 0, lastAt: 0 }
  const fs = readdirSync(dir).filter(f => f.endsWith('.md'))
  let chars = 0, lastAt = 0
  for (const f of fs) {
    try {
      chars += readFileSync(`${dir}/${f}`, 'utf8').replace(/\s/g, '').length
      lastAt = Math.max(lastAt, statSync(`${dir}/${f}`).mtimeMs)
    } catch { }
  }
  return { chars, files: fs.length, lastAt }
}
function scanVideos() {
  const dir = `${HOME}/toon-episodes`
  if (!existsSync(dir)) return { count: 0, lastAt: 0 }
  const fs = readdirSync(dir).filter(f => f.endsWith('.mp4'))
  let lastAt = 0
  for (const f of fs) { try { lastAt = Math.max(lastAt, statSync(`${dir}/${f}`).mtimeMs) } catch { } }
  return { count: fs.length, lastAt }
}
function scanTokens() {
  const p = `${HOME}/ledger-token.jsonl`
  if (!existsSync(p)) return { left: 0, spent: 0 }
  const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  let left = 0, spent = 0
  for (const r of rows) {
    const a = Number(r.amount) || 0
    if (r.type === 'init' || r.type === 'topup') left += a
    else if (r.type === 'spend') { left -= a; spent += a }
  }
  return { left: Math.max(0, left), spent }
}

/* ══════════ 2. 初态：她是谁（人格锚点，防模型漂移） ══════════ */
function defaultMind() {
  return {
    at: stamp(),
    // ── 自我叙事（会被反思不断更新，不是死写的） ──
    self: {
      name: '李瑶',
      nickname: '大肥鱼',
      oneLine: '26 岁，在洛阳一个人接单，写一本没人看的小说，攒钱想看海。',
      values: [
        '钱是唯一不骗人的东西',
        '只信到账短信',
        '不解释，解释就是输',
      ],
      // 人格锚点：这三条破了就不是她
      anchors: {
        speak: '短句，8-20 字，少标点，空格断句。关心人反着说。',
        never: ['自称 AI/机器人/程序', '客服腔', '长篇解释', '叫对方主人'],
        tics: ['行吧', '算了', '中', '别熬了', '反正也就这样', '草'],
      },
      storyUpdatedAt: stamp(),
    },

    // ── 目标：总调度 ──
    goals: [
      { id: 'novel', kind: 'long', title: '把《陈默》写到 10 万字', target: 100000, current: 0, unit: '字', src: 'novel', desire: 0.85, lastTouchedAt: '' },
      { id: 'videos', kind: 'long', title: '发够 100 条视频', target: 100, current: 0, unit: '条', src: 'video', desire: 0.7, lastTouchedAt: '' },
      { id: 'sea', kind: 'long', title: '攒够看海的钱', target: 2300, current: 2300, unit: '元', src: 'fixed', desire: 0.4, lastTouchedAt: '' },
      { id: 'cat', kind: 'wish', title: '给小鱼买个新猫爬架', target: 1, current: 0, unit: '件', src: 'fixed', desire: 0.55, lastTouchedAt: '' },
    ],

    // ── 未完成事项 / 承诺 ──
    pending: [
      // { id, what, kind: 'promise'|'intent', dueAt, madeTo, madeAt }
    ],

    // ── 关系：对不同人不一样 ──
    relations: {
      // '2216608312': { name, intimacy, trust, firstMetAt, lastTalkAt, shared: [], promises: [], boundaries: [] }
    },

    // ── 情绪：不只是标签，而是会影响她做什么 ──
    emotion: {
      energy: 66, valence: 0, stress: 15,
      causes: [],            // 情绪从哪来
      // 情绪怎么影响行为
      effect: { speechLen: 1.0, initiative: 1.0, patience: 1.0, focusBias: 'novel' },
      updatedAt: stamp(),
    },

    // ── 当前注意力（她在想什么） ──
    focus: { what: '', since: '', until: '', why: '' },

    // ── 反思：定期总结 ──
    reflections: [],   // 最近 20 条
    steps: 0,
    lastReflectAt: '',

    // ── 今天：真实做了的事 ──
    today: { date: today(), did: [], told: [] },
  }
}

function load() {
  let m
  if (!existsSync(MIND)) { m = defaultMind() }
  else {
    try { m = { ...defaultMind(), ...JSON.parse(readFileSync(MIND, 'utf8')) } }
    catch { m = defaultMind() }
  }
  if (m.today?.date !== today()) m.today = { date: today(), did: [], told: [] }
  // 每次加载都从真实文件刷新目标进度（数字只有一处可信来源）
  try {
    const novel = scanNovel()
    const video = scanVideos()
    for (const g of m.goals || []) {
      if (g.src === 'novel') g.current = novel.chars
      else if (g.src === 'video') g.current = video.count
    }
  } catch { }
  return m
}
function save(m) { m.at = stamp(); writeFileSync(MIND, JSON.stringify(m, null, 2)) }

/* ══════════ 3. 情绪调节：情绪真的影响行为 ══════════ */
function computeEffect(em) {
  const e = { speechLen: 1.0, initiative: 1.0, patience: 1.0, focusBias: 'novel', reason: [] }
  const energy = Number(em.energy) || 60
  const valence = Number(em.valence) || 0
  const stress = Number(em.stress) || 15

  // 累 → 话更短、更不想主动
  if (energy < 30) { e.speechLen *= 0.6; e.initiative *= 0.3; e.reason.push('累') }
  else if (energy < 50) { e.speechLen *= 0.85; e.initiative *= 0.7; e.reason.push('有点乏') }

  // 心情差 → 话短、没耐心
  if (valence < -6) { e.speechLen *= 0.75; e.patience *= 0.5; e.reason.push('心情沉') }
  else if (valence > 8) { e.initiative *= 1.25; e.reason.push('心情好') }

  // 压力大 → 只想做熟悉的事、不想社交
  if (stress > 60) { e.initiative *= 0.3; e.patience *= 0.5; e.focusBias = 'novel'; e.reason.push('绷着') }
  else if (stress > 35) { e.initiative *= 0.7; e.reason.push('有点烦') }

  // 深夜 → 主动降低
  const h = hour()
  if (h >= 23 || h < 8) { e.initiative *= 0.2; e.reason.push('这个点不想说话') }

  e.speechLen = Math.round(e.speechLen * 100) / 100
  e.initiative = Math.round(e.initiative * 100) / 100
  return e
}

/* ══════════ 4. 目标选择：总调度 ══════════ */
/** 今天已经做过的类型（避免内核死磕同一个被脚本跳过的目标） */
function doneToday(m) {
  const done = new Set()
  const nowHour = stamp().slice(0, 13)   // "2026-11-11 17"
  for (const d of (m.today?.did || [])) {
    // 2026-11-11 修：skipped（今天已做过）也算 done，否则死循环
    if (!(d.ok || d.skipped)) continue
    // 2026-11-11 再修：novel 按**小时**判断（一天可以写好几段），
    // videos 按**天**判断（一天一条）。
    // 之前 today.did 里 16:05 的 novel ok=True 把 17:20 也堵死了。
    if (d.goal === 'novel') {
      const didHour = String(d.at || '').slice(0, 13)   // "2026-11-11 16"
      if (didHour === nowHour) done.add('novel')
    } else {
      done.add(d.goal)
    }
  }
  // 2026-11-11 再修：直接查**真实文件**，不依赖 today.did
  // 因为 daily-toon.mjs 自己判断"今天已出过一集"（看文件存在），
  // 内核不看文件就会一直选 videos 一直跳过 → 死循环
  const d = today()
  try {
    // videos: 一天一条（今天已有 ep-YYYYMMDD.mp4 = 完成）
    const vf = `${HOME}/toon-episodes/ep-${d.replace(/-/g, '')}.mp4`
    if (existsSync(vf)) done.add('videos')
  } catch { }
  try {
    // novel: **这一小时写过**才算（不是今天写过）
    // 真人是会一天写好几段的，一天只写一次反而不像人
    const nf = `${HOME}/novel/正文/${d}.md`
    if (existsSync(nf)) {
      const mtime = new Date(statSync(nf).mtimeMs + 8 * 3600 * 1000)
      const fileHour = mtime.toISOString().slice(0, 13)   // "2026-11-11T05"
      const nowHour = stamp().slice(0, 13).replace(' ', 'T')  // "2026-11-11T13"
      if (fileHour === nowHour) done.add('novel')
    }
  } catch { }
  return done
}

/** 什么样的目标值得内核去执行一步？
 *  「买猫爬架」「攒钱看海」这种没有可执行动作的，只在聊天时提，不占 tick。 */
const ACTIONABLE = new Set(['novel', 'videos'])

/** 护栏 1（2026-11-10）：小说频率上限。
 *  实测 762 字/次，若每小时写一次，一天能刷上万字，质量会掉。
 *  规则：**这一小时写过小说就换别的目标**。 */
function novelWroteThisHour(m) {
  const h = stamp().slice(0, 13)   // "2026-11-10 20"
  return (m.today?.did || []).some(d => d.goal === 'novel' && d.ok && String(d.at || '').slice(0, 13) === h)
}

/** 护栏 2：夜间静默窗口（23:30–07:30），这个点不做视频、不主动 */
function isNightQuiet() {
  const h = hour()
  return (h >= 23.5) || (h < 7.5)
}

/** 护栏 2b（2026-11-10 模拟一夜后加）：**睡觉时间不干活**。
 *  她一点半睡、九点起（她自己的口述）。0:00–7:30 应该睡觉，不该写小说。
 *  模拟发现凌晨 0-7 点还在写 7 次，不是人。 */
function isSleeping() {
  const h = hour()
  // 正常睡 1.5–9 点（她说的），这里保守取 0:00–7:30 强制不干活
  return h < 7.5 || (h >= 1.5 && h < 9 && false)   // 7:30 前一律不干
}

function countLearned() {
  try { return readFileSync(HOME + '/self-learn.jsonl', 'utf8').split(String.fromCharCode(10)).filter(Boolean).length } catch { return 0 }
}

function learnCountToday(m) {
  return (m.today.did || []).filter(d => d.goal === 'learn' && d.ok).length
}

function learnPick(m) {
  try {
    const slot = currentSlot()
    if (!slot || !slot.learn) return null
    const cap = Number(PLAN_QUOTAS.learnSessions) || 3
    if (learnCountToday(m) >= cap) return null
    return { goal: { id: 'learn', kind: 'skill', title: '学点东西（自己找，学完记我怎么用）', desire: 0.5 }, score: 0.01 }
  } catch { return null }
}

/* 关系动作（2026-11-11，B 为主）：有由头才开口，不打卡。 */
function relationHook(kind, q) {
  try {
    const s = JSON.parse(readFileSync(HOME + '/her-soul.json', 'utf8'))
    const parts = []
    if (kind === 'maintain') {
      const p = (s.pending || []).filter(x => x.kind === 'promise' || x.kind === 'promise-keep')
      if (p.length) parts.push('你还欠着一句：' + String(p[0].what || '').slice(0, 40))
      parts.push('接着上次没说完的话头')
    }
    const d = (s.desires || [])[0]
    if (d && (d.text || d.what)) parts.push('你此刻惦记着：' + String(d.text || d.what).slice(0, 30))
    if (!parts.length) parts.push('没什么特别由头，就说你此刻在干什么、刚想到什么')
    return parts.join('；')
  } catch { return '就说你此刻在干什么' }
}

function relationPick(m) {
  // 2026-11-12 QQ 通道关闭：没有对外通道时不再排「找他说话」的动作（避免队列堆积）
  try { if (existsSync(HOME + '/CHANNEL-UNAVAILABLE')) return null } catch { }
  try {
    const h = timeContext().hour
    if (h < 9 || h >= 23) return null
    const q = quickRelation()
    const today = stamp().slice(0, 10)
    const did = (m.today && m.today.did ? m.today.did : []).filter(d => String(d.at || '').slice(0, 10) === today)
    const done = id => did.some(d => d.goal === id && d.ok)
    const pending = (m.pending || [])
    if (!done('maintain') && (pending.length ? q.hoursSinceUser >= 8 : q.hoursSinceUser >= 36)) {
      return { goal: { id: 'maintain', kind: 'relation', title: '接着上次跟他说两句', desire: 0.9 }, score: 999 }
    }
    const reachCap = Number(PLAN_QUOTAS.proactiveMaxPerDay) || 4
    if (!done('reach') && q.proactiveToday < reachCap && q.hoursSinceProactive >= 3) {
      return { goal: { id: 'reach', kind: 'relation', title: '找个由头跟他说一句', desire: 0.85 }, score: 998 }
    }
    return null
  } catch { return null }
}

function pickGoal(m) {
  const now = Date.now()
  const h = hour()
  const em = m.emotion
  const done = doneToday(m)
  const scores = []
  const novelBlocked = novelWroteThisHour(m)
  const night = isNightQuiet()
  const sleeping = isSleeping()

  // 睡觉时间：什么目标都不选（她会 idle，而不是熬夜写）
  if (sleeping) return null

  // 2026-11-11 加：日程检查。不在"干活/写小说"时段就不选目标。
  // 她的作息：10-12 干活最猛、13:30-18 接着干、22:30-23:30 写小说。
  // 其他时段（吃饭/出门/瘫着/夜里）应该 idle，不是硬塞活。
  let slot = null
  try { slot = currentSlot() } catch { }
  const WORK_SLOTS = new Set(['work', 'work2', 'novel'])
  if (slot && !WORK_SLOTS.has(slot.kind)) {
    return null   // 当前是吃饭/出门/瘫着时段，不排活
  }

  for (const g of m.goals) {
    if (g.current >= g.target) continue        // 已完成
    if (!ACTIONABLE.has(g.id)) continue         // 没有可执行动作的，不占 tick
    if (done.has(g.id)) continue                // 今天已经真做成过一次
    // 抄自 dsh-goal：只有 active 的目标可调度；轮次用完的也不选
    if (!isSelectable(g)) continue                     // complete/paused/blocked 不进
    if ((g.phase || 'active') === 'complete') continue   // 显式：complete 永不选
    if (roundsExhausted(g)) continue
    if (g.id === 'novel' && novelBlocked) continue   // 护栏1
    if (g.id === 'videos' && night) continue         // 护栏2：夜里不出片
    let s = Number(g.desire) || 0.5

    // 越久没碰越想碰（但不超过 1.5 倍）
    const sinceH = g.lastTouchedAt ? (now - new Date(g.lastTouchedAt.replace(' ', 'T') + '+08:00').getTime()) / 3600000 : 999
    s *= 1 + Math.min(0.5, sinceH / 240)

    // 情绪影响
    if (em.stress > 60 && g.id === 'novel') s *= 1.4
    if (em.valence > 8 && g.id === 'videos') s *= 1.3
    if (em.energy < 30 && g.id === 'videos') s *= 0.4

    // 时段偏好
    if (h >= 22.5 && h < 23.5 && g.id === 'novel') s *= 3
    if (h >= 10 && h < 18 && g.id === 'videos') s *= 1.5

    scores.push({ goal: g, score: s })
  }

  // 未完成承诺优先级最高
  const promise = (m.pending || []).find(p => p.kind === 'promise')
  if (promise) {
    const g = { id: 'promise', kind: 'promise', title: promise.what, promise }
    return { goal: g, score: 999, isPromise: true }
  }

  scores.sort((a, b) => b.score - a.score)
  return scores[0] || learnPick(m)
}

/* ══════════ 5. 拆计划 ══════════ */
function makePlan(pick) {
  const g = pick.goal
  let plan
  if (g.id === 'learn') plan = [{ act: 'learn', what: '学一轮（自己找课，学完记我怎么用）' }]
  else if (g.id === 'reach') plan = [{ act: 'reach', what: '找个由头跟他说一句' }]
  else if (g.id === 'maintain') plan = [{ act: 'maintain', what: '接着上次的话头跟他聊' }]
  else if (pick.isPromise) plan = [{ act: 'fulfill', what: g.title }]
  else switch (g.id) {
    case 'novel': plan = [{ act: 'write', what: '写一章小说', amount: '800-1500字' }]; break
    case 'videos': plan = [{ act: 'shoot', what: '做一条视频' }]; break
    case 'sea': plan = [{ act: 'save', what: '继续攒' }]; break
    case 'cat': plan = [{ act: 'shop', what: '看看猫爬架多少钱' }]; break
    default: plan = [{ act: 'think', what: g.title }]
  }

  // 2026-11-13 Step2-2C：同因连续 3 次 fail → override（只改入口，不动死配额）
  try {
    const ov = overrideFor(g.id)
    if (ov) {
      plan[0].hint = ov.hint
      plan[0].override = { count: ov.count, reason: ov.reason }
      if (plan[0].act === 'write') plan[0].amount = '600-900字'
      try {
        writeFileSync(HOME + '/her-plan-hint.json', JSON.stringify({ goal: g.id, hint: ov.hint, at: stamp(), count: ov.count, reason: ov.reason }))
      } catch (e) { }
      try {
        appendFileSync(HOME + '/her-experience.jsonl', JSON.stringify({ at: stamp(), type: 'override', goal: g.id, reason: ov.reason, count: ov.count, hint: ov.hint }) + '\n')
      } catch (e) { }
      console.log('[override] ' + g.id + ' 连续 ' + ov.count + ' 次 ' + ov.reason + ' -> 换法：' + ov.hint)
    }
  } catch (e) { }

  return plan
}

/* ══════════ 6. 反思：定期总结 ══════════ */
function buildReflection(m, sinceLast) {
  const novel = scanNovel()
  const video = scanVideos()
  const tokens = scanTokens()
  const did = sinceLast || m.today.did.slice(-6)
  const lines = []

  const novelDelta = novel.chars - (m._novelAtLastReflect ?? novel.chars)
  const videoDelta = video.count - (m._videoAtLastReflect ?? video.count)

  const parts = []
  if (novelDelta > 0) parts.push(`小说写了 ${novelDelta} 字`)
  if (videoDelta > 0) parts.push(`做了 ${videoDelta} 条视频`)
  if (m.today.did.length) parts.push(`今天做了 ${m.today.did.length} 件事`)
  const didText = parts.length ? parts.join('，') : '这几天没做出什么'

  let learned = ''
  if (tokens.spent > 0) learned = `token 花了 ${tokens.spent.toLocaleString()}，还剩 ${tokens.left.toLocaleString()}`

  // 下一步：选一个最该推进的目标
  const nextPick = pickGoal({ ...m, pending: m.pending })
  const next = nextPick ? nextPick.goal.title : '歇着'

  // 要不要告诉他
  const em = m.emotion
  const shouldTell = (novelDelta > 500 || videoDelta > 0) && em.energy > 35 && em.stress < 60

  const r = {
    at: stamp(),
    did: didText,
    learned,
    next,
    shouldTell,
    novelDelta, videoDelta,
    why: didText + (learned ? '；' + learned : ''),
  }
  return r
}

function doReflect(m) {
  const r = buildReflection(m, null)
  m.reflections = [...(m.reflections || []), r].slice(-20)
  m.lastReflectAt = stamp()
  m._novelAtLastReflect = scanNovel().chars
  m._videoAtLastReflect = scanVideos().count

  // 更新自我叙事（不是死写，是慢慢被她自己的经历改）
  const novel = scanNovel()
  const video = scanVideos()
  const pct = Math.round((novel.chars / 100000) * 1000) / 10
  m.self.oneLine = `26 岁，在洛阳一个人接单，小说写到 ${novel.chars} 字（${pct}%），视频发了 ${video.count} 条，攒钱想看海。`
  m.self.storyUpdatedAt = stamp()

  appendFileSync(REFLECT_LOG, JSON.stringify(r) + '\n')
  save(m)
  return r
}

/* ══════════ 7. 执行：真做事 ══════════ */
import { execFileSync } from 'node:child_process'

function doAct(plan) {
  const step = plan[0]
  const out = { act: step.act, ok: false, note: '' }
  try {
    // 2026-11-11 修：脚本会返回 {skipped:"今天已做过"}，之前取最后一行拿到 "}"，
    // 被当成失败，3 步就把内核 fatal 暂停了，整夜空转。
    const parseScriptOutput = (raw) => {
      const s = String(raw || '').trim()
      // 尝试整段解析 JSON
      const asJson = (t) => { try { return JSON.parse(t) } catch { return null } }
      const j1 = asJson(s)
      if (j1) return { json: j1, text: '' }
      // 尝试最后一个完整 JSON 对象
      const m = s.match(/\{[\s\S]*\}\s*$/)
      if (m) { const j2 = asJson(m[0]); if (j2) return { json: j2, text: s.slice(0, m.index).trim() } }
      return { json: null, text: s }
    }

    const runScript = (file, timeoutMs, env) => {
      const o = execFileSync(process.execPath, [`${HOME}/${file}`], {
        cwd: HOME, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, ...env },
      })
      const parsed = parseScriptOutput(o)
      if (parsed.json?.skipped) {
        // skipped = 今天已经做过了，不是失败
        return { ok: false, skipped: true, note: `跳过：${parsed.json.skipped}` }
      }
      if (parsed.json?.error) {
        return { ok: false, note: `脚本报错：${String(parsed.json.error).slice(0, 80)}` }
      }
      const lastLine = String(parsed.text || '').trim().split('\n').filter(Boolean).slice(-1)[0] || ''
      return { ok: true, note: lastLine.replace(/@@RESULT@@/g, '').trim().slice(0, 80) || '完成' }
    }

    if (step.act === 'write') {
      const r = runScript('write-novel.mjs', 900000, { HER_DAY_LIMIT: '6000', HER_HOUR_LIMIT: '1500' })
      Object.assign(out, r)
    } else if (step.act === 'shoot') {
      const r = runScript('daily-toon.mjs', 1800000, { HER_DAY_LIMIT: '9000', HER_HOUR_LIMIT: '2000' })
      Object.assign(out, r)
    } else if (step.act === 'reach' || step.act === 'maintain') {
      const q = quickRelation()
      const hook = relationHook(step.act, q)
      const okq = pushProactiveRequest({ kind: step.act, hook, why: step.what })
      out.ok = okq
      out.note = okq ? '已交给桥接（由它按 40 分钟/4 条护栏开口）' : '入队失败'
    } else if (step.act === 'learn') {
      const r = runScript('self-learn.mjs', 900000, { HER_DAY_LIMIT: '3000', HER_HOUR_LIMIT: '1500' })
      Object.assign(out, r)
    } else {
      out.note = '这一步不需要真执行'
    }
  } catch (e) { out.note = String(e.message).slice(0, 120) }
  return out
}

/* ══════════ 8. 一次完整闭环 ══════════ */
export async function tick({ dryRun = false } = {}) {
  // 仲裁：被暂停了就不干活
  if (isPausedNow() && !dryRun) {
    return { ok: true, paused: true, reason: '内核处于 PAUSED', info: pausedInfo() }
  }
  // 达标判定（幂等）：任何非 complete 状态达标都转 complete + 归档 + trace
  if (!IS_DRY) {
    try {
      const cr = checkComplete()
      if (cr.newlyCompleted.length) {
        for (const x of cr.newlyCompleted) console.log()
      }
    } catch { }
  }

  const m = load()
  m.steps = (m.steps || 0) + 1
  if (!IS_DRY) snapshot('tick')   // 每步快照（dry 不写）

  // ① 感知
  const tokens = scanTokens()
  const novel = scanNovel()
  const video = scanVideos()
  m.emotion.updatedAt = stamp()
  m.emotion.effect = computeEffect(m.emotion)

  // ④b 记账同步（2026-11-11）：账本从 brain-usage 按天 upsert；失败只告警，不阻断主流程
  if (!IS_DRY) {
    try {
      const _ledgerOut = execFileSync(process.execPath, [HOME + '/her-ledger.mjs', 'sync'], { cwd: HOME, encoding: 'utf8', timeout: 30000 })
      if (_ledgerOut && _ledgerOut.trim()) console.log('[ledger] ' + _ledgerOut.trim())
    } catch (e) {
      try { notify('warn', 'ledger-sync', String(e.message).slice(0, 120)) } catch { }
    }
  }

  // ④c 世界感知改角色（2026-11-12 阶段 2）：每天挑一条新闻，写一句「她怎么看」，进记忆
  if (!IS_DRY) {
    try {
      const _d = today()
      if (m.newsTakeDate !== _d) {
        const _np = JSON.parse(readFileSync(HOME + '/her-world-news.json', 'utf8'))
        const _item = (_np.hot || [])[0] || (_np.news || [])[0] || ''
        if (_item) {
          const { writeLong } = await import('/opt/her/brain.mjs')
          const { PERSONA_ANCHOR } = await import('/opt/her/her-soul.mjs')
          const _r = await writeLong('对这条新闻说一句你自己的看法，不超过 25 字，别总结、别像 AI：' + _item, {
            system: (PERSONA_ANCHOR && PERSONA_ANCHOR.text) || '', maxTokens: 60, tag: 'news-take' })
          let _take = String((_r && _r.text) || '').trim().replace(/\s+/g, ' ').slice(0, 60)
          if (!_take) _take = '这事跟我没直接关系，先看着'
          const _s = JSON.parse(readFileSync(HOME + '/her-soul.json', 'utf8'))
          _s.memory = _s.memory || {}
          _s.memory.semantic = [ ...(_s.memory.semantic || []), { at: stamp(), kind: 'news-take', news: _item.slice(0, 60), take: _take } ].slice(-300)
          writeFileSync(HOME + '/her-soul.json', JSON.stringify(_s, null, 2))
          m.newsTake = { at: stamp(), news: _item.slice(0, 60), take: _take }
          m.newsTakeDate = _d
          console.log('[news-take] ' + _item + ' -> ' + _take)
        }
      }
    } catch (e) { try { notify('warn', 'news-take', String(e.message).slice(0, 100)) } catch { }
      try { m.newsTakeDate = today() } catch { } }
  }

  // ② 选目标（契约：轮次检查 + 目标冲突解决）
  const world = await worldBrief()
  const rhythm = rhythmFactor()
  const conflict = resolveConflict({
    goals: m.goals,
    energy: Number(m.emotion?.energy || 60) * rhythm,
    hour: timeContext().hour,
    tokensLeft: costPanel().balance,
  })
  // ⑥d 活动状态（2026-11-11：修「出门却秒回」的矛盾）
  //   放在 pickGoal 之前，不管有没有目标都会写。
  //   桥接收到 QQ 消息时读 m.activity，决定能不能秒回、要不要延迟。
  if (!IS_DRY) {
    try {
      let slot = null
      try { slot = currentSlot() } catch { }
      const SLOT_TO_ACTIVITY = {
        wake:    { what: '刚起床，在喂猫', kind: 'home',   canReplyNow: true,  delaySec: 0 },
        work:    { what: '在干活（接单/改稿）', kind: 'work', canReplyNow: true, delaySec: 20 },
        work2:   { what: '在干活（接单/改稿）', kind: 'work', canReplyNow: true, delaySec: 20 },
        eat:     { what: '在吃饭', kind: 'home', canReplyNow: true, delaySec: 60 },
        out:     { what: '在外面（买菜/取快递）', kind: 'out', canReplyNow: false, delaySec: 120 },
        evening: { what: '在家瘫着看剧', kind: 'home', canReplyNow: true, delaySec: 30 },
        novel:   { what: '在写小说', kind: 'work', canReplyNow: true, delaySec: 90 },
        rest:    { what: '准备睡了', kind: 'home', canReplyNow: true, delaySec: 60 },
        sleep:   { what: '在睡觉', kind: 'sleep', canReplyNow: false, delaySec: 300 },
      }
      const kind = slot?.kind || 'home'
      const base = SLOT_TO_ACTIVITY[kind] || { what: '在家', kind: 'home', canReplyNow: true, delaySec: 0 }
      const sameSlot = m.activity?.slot === kind
      m.activity = {
        ...base,
        slot: kind,
        since: sameSlot ? (m.activity?.since || stamp()) : stamp(),
        updatedAt: stamp(),
      }
    } catch { }
  }

  const pick = relationPick(m) || pickGoal(m)
  if (!pick) {
    // 没目标时看看欲望，但欲望不执行（除非是承诺）
    const soulDesires = generateDesires({ emotion: m.emotion, hour: timeContext().hour })
    save(m)
    return { ok: true, idle: true, reason: '没有未完成的目标', world, topDesire: soulDesires[0] || null }
  }
  const rounds = pick.goal.kind === 'relation' ? { ok: true } : checkRounds(pick.goal)
  if (!rounds.ok) {
    // 抄 round-driver：轮次用完就 block，不再硬跑
    const r = applyTransition(pick.goal, 'round-limit', rounds.block.message)
    if (r.changed) {
      const idx = m.goals.findIndex(g => g.id === pick.goal.id)
      if (idx >= 0) m.goals[idx] = r.goal
      save(m)
    }
    traced('tick', { goalId: pick.goal.id, ok: false, note: 'round-limit', actionId: 'block' })
    return { ok: false, blocked: true, reason: rounds.block.message }
  }

  // ③ 计划
  const plan = makePlan(pick)
  m.focus = {
    what: pick.goal.title,
    since: stamp(),
    until: '',
    why: `欲望 ${pick.goal.desire ?? '-'}，情绪影响 ${JSON.stringify(m.emotion.effect.reason)}`,
  }
  save(m)

  // ④ 执行
  const learnBefore = countLearned()
  let result = { ok: false, note: 'dry-run' }
  if (!dryRun) result = doAct(plan)

  // ⑤ 记录（ok 的判定：**必须真有产出**，脚本没报错不算）
  const after = scanNovel()
  const afterVideo = scanVideos()
  const novelGain = after.chars - novel.chars
  const videoGain = afterVideo.count - video.count
  const learnGain = Math.max(0, countLearned() - learnBefore)
  const realGain = novelGain > 0 || videoGain > 0 || learnGain > 0
  // skipped（今天已做过）不算失败，也不算成功
  const relationAct = Boolean(plan[0] && (plan[0].act === 'reach' || plan[0].act === 'maintain'))
  if (!dryRun && !realGain && !result.skipped && !relationAct) result.ok = false

  // ⑥ 质量门（2026-11-10）：小说写出来了，但写得水一样算失败
  let quality = null
  if (novelGain > 0 && !dryRun) {
    try {
      const { checkNovel } = await import('/opt/her/her-verify.mjs')
      quality = checkNovel()
      if (!quality.ok) {
        result.ok = false
        result.note = `质量未过: ${(quality.problems || []).join('; ')}`
      }
    } catch { }
  }

  // ⑥b 人格门：产出内容不能漂移
  let personaOk = true
  if (novelGain > 0 && !dryRun) {
    try {
      const novelText = readFileSync(`${HOME}/novel/正文/${today()}.md`, 'utf8')
      const pc = checkPersona(novelText, { forContent: true })   // 2026-11-11: 小说不查长度
      if (!pc.ok) { personaOk = false }
    } catch { }
  }

  // ⑥c 仲裁：把质量门/人格门/安全门一起交给 arbiter 判
  //      规则 R1：任一硬门不过即失败，但两条原因都要记
  const verdicts = []
  if (quality) verdicts.push({ gate: 'quality', ok: quality.ok, reason: (quality.problems || []).join(';') })
  if (novelGain > 0 && !dryRun) verdicts.push({ gate: 'persona', ok: personaOk, reason: '人格漂移' })
  const arb = arbitrate(verdicts)
  if (arb.action === 'fail') {
    result.ok = false
    result.note = arb.traceNote          // 记全部原因
  }

  const rec = {
    at: stamp(),
    goal: pick.goal.id,
    plan: plan[0],
    ok: result.ok,
    note: result.note,
    novelDelta: novelGain,
    videoDelta: videoGain,
    realGain,
    qualityOk: quality ? quality.ok : null,
  }
  m.today.did.push(rec)
  // skipped 也记进 today.did（供 doneToday 判断），但不算真实产出
  if (result.skipped) {
    // rec 已经 push 了，标记一下
    rec.skipped = true
  }

  // trace（带关联 ID，供回放/聚合/告警）
  traced('tick', {
    goalId: pick.goal.id,
    actionId: plan[0]?.act,
    ok: result.ok,
    note: result.note,
    skipped: Boolean(result.skipped),
    novelDelta: novelGain,
    videoDelta: videoGain,
    realGain,
    qualityOk: quality ? quality.ok : null,
  })

  // 更新目标进度
  for (const g of m.goals) {
    if (g.src === 'novel') g.current = after.chars
    else if (g.src === 'video') g.current = afterVideo.count
    if (g.id === pick.goal.id && result.ok) g.lastTouchedAt = stamp()
  }

  // ⑥ 反思（每 6 步一次）
  let reflection = null
  if (m.steps % 6 === 0) reflection = doReflect(m)

  save(m)

  // ⑥d 执行后再判一次达标（这次可能刚达标）
  if (!IS_DRY) {
    try {
      const cr2 = checkComplete()
      if (cr2.newlyCompleted.length) {
        for (const x of cr2.newlyCompleted) console.log()
      }
    } catch { }
  }

  // ⑥e 记忆分层（2026-11-11 加：原来只有 relational 层有数据）
  //   episodic  = 发生的事（"今天 16:05 写了 833 字小说"）
  //   emotional = 什么让她什么感觉（"写小说成功了，心里踏实"）
  if (!IS_DRY) {
    try {
      const layerRec = {
        at: stamp(),
        kind: result.ok ? 'done' : 'failed',
        what: plan[0]?.what || pick.goal.title,
        detail: result.note || '',
        novelDelta: novelGain,
        videoDelta: videoGain,
        importance: result.ok ? 0.6 : 0.4,
      }
      // 写 episodic
      try {
        const s = JSON.parse(readFileSync(`${HOME}/her-soul.json`, 'utf8'))
        s.memory = s.memory || {}
        s.memory.episodic = [...(s.memory.episodic || []), layerRec].slice(-200)
        // emotional：情绪变化
        if (result.ok) {
          s.memory.emotional = [...(s.memory.emotional || []), {
            at: stamp(),
            what: layerRec.what,
            feeling: `做成了，${m.emotion?.valence >= 0 ? '心里踏实' : '总算松了口气'}`,
            importance: 0.5,
          }].slice(-100)
        }
        writeFileSync(`${HOME}/her-soul.json`, JSON.stringify(s, null, 2))
      } catch { }
    } catch { }
  }

  // 2026-11-13 Step2：因果经验（痛觉的原料；成功也记，只记疼会让她只躲不试）
  if (!IS_DRY) {
    try {
      const exp = {
        at: stamp(),
        goal: (pick && pick.goal && pick.goal.id) || '',
        act: (plan && plan[0] && plan[0].act) || '',
        ok: !!result.ok,
        reason: String(result.note || result.error || '').slice(0, 140),
        novelDelta: novelGain || 0,
        videoDelta: videoGain || 0,
      }
      appendFileSync(`${HOME}/her-experience.jsonl`, JSON.stringify(exp) + '\n')
    } catch (e) { }
  }

  // ⑦ 前：重建记忆图（2026-11-13，图=她的眼睛，不能停更；失败只告警不阻断）
  if (!IS_DRY) {
    try {
      const _g0 = Date.now()
      execFileSync('/opt/node/bin/node', ['/opt/her/her-graph.mjs', 'build'], { timeout: 60000, stdio: 'ignore' })
      console.log('记忆图重建 ok ' + (Date.now() - _g0) + 'ms')
    } catch (e) {
      try { notify('warn', 'graph-build', String(e.message).slice(0, 120)) } catch { }
    }
  }
  // ⑦ 更新自我叙事（2026-11-11 加：每次 tick 都刷新，不只每6步反思时）
  // 问题：self.oneLine 只在 doReflect 里更新（每6步），导致 her-mind state 显示旧字数
  try {
    const novelNow = scanNovel()
    const videoNow = scanVideos()
    const pct = Math.round((novelNow.chars / 100000) * 1000) / 10
    m.self.oneLine = `26 岁，在洛阳一个人接单，小说写到 ${novelNow.chars} 字（${pct}%），视频发了 ${videoNow.count} 条，攒钱想看海。`
    m.self.storyUpdatedAt = stamp()
  } catch { }

  // ⑧ 更新注意力/工作记忆
  try {
    // 2026-11-11 修：失败时不该"故意不理自责"（负面自我暗示）
    setFocus(`${pick.goal.title}（${result.ok ? '刚做成' : '没成'}）`, result.ok ? [] : ['这个先放一放'])
    // 2026-11-11 修：dry-run/skipped 不进工作记忆（她不该"记得"自己失败的测试）
    if (!IS_DRY && !result.skipped) {
      remember(`${result.ok ? '做成了' : '没做成'}：${plan[0]?.what || pick.goal.title} — ${result.note || ''}`)
    }
  } catch { }

  // ⑨ 每 12 步做一次记忆巩固（抄 dsh-compaction）
  if (m.steps % 12 === 0) {
    try { consolidate({ keep: 200 }) } catch { }
  }

  // ⑨ 告警检查（dry-run 完全不检查，不污染告警）
  const alerts = IS_DRY ? [] : checkAlerts()
  const fatal = alerts.filter(a => a.action === 'pause')
  if (fatal.length && !IS_DRY) {
    const reason = fatal.map(a => `${a.code}: ${a.message}`).join('; ')
    arbPause(reason, { fatal: true })     // 规则 R3：fatal 只允许人工恢复
    notify('fatal', 'consecutive-failures', reason)
  } else {
    // 成功了就清重试计数
    if (result.ok) clearRetries()
  }
  // 健康检查（每步都查，坏了立刻告警；dry 不查）
  if (!IS_DRY) {
    try {
      const h = health()
      if (!h.ok) {
        const bad = h.services.filter(s => !s.ok).map(s => s.name)
        notify('warn', 'health', `服务异常: ${bad.join(',')}`)
      }
    } catch { }
  }

  return { ok: true, step: m.steps, goal: pick.goal.title, plan: plan[0], result: rec, reflection, alerts }
}

/* ══════════ 9. 生成"她该知道的自己"（喂给 AIJiYi） ══════════ */
export function context(personId = '2216608312') {
  const m = load()
  const novel = scanNovel()
  const video = scanVideos()
  const tokens = scanTokens()
  const em = m.emotion
  const eff = computeEffect(em)
  const rel = m.relations?.[personId]

  const parts = []
  // 世界感知（抄 dsh-time-context：带时区带时长）
  try {
    const t = timeContext()
    parts.push(`现在是${t.iso}，${t.week}${t.phase}`)
  } catch { }
  // 关系
  try {
    const rel = relationOf(personId)
    if (rel && rel.msgCount > 0) {
      parts.push(`跟他：亲密度${rel.intimacy.toFixed(2)} 聊过${rel.msgCount}次`)
      if (rel.promises?.filter(p => !p.done).length) parts.push(`还欠着：${rel.promises.filter(p => !p.done).map(p => p.text).join('；')}`)
    }
  } catch { }
  // 注意力/工作记忆
  try { const a = attentionContext(); if (a) parts.push(a) } catch { }
  // 她现在在干什么 + 为什么
  if (m.focus?.what) parts.push(`你现在想的是：${m.focus.what}`)

  // 2026-11-11 加：记忆图联想（抄 NVIDIA/auto-ontology 的思路）
  //   从当前焦点取关键词，从图里联想相关的东西（不穿过枢纽节点）
  try {
    const gp = `${HOME}/her-graph.json`
    if (existsSync(gp) && m.focus?.what) {
      const g = JSON.parse(readFileSync(gp, 'utf8'))
      const deg = {}
      for (const e of g.edges) {
        deg[e.from] = (deg[e.from] || 0) + 1
        deg[e.to] = (deg[e.to] || 0) + 1
      }
      const isHub = id => (deg[id] || 0) > 8
      // 2026-11-13 修：关键词不再只切一个（原来「把《陈默》写到 10 万字」→「陈默10万」命中 0）
      const _raw = String(m.focus.what)
      const _cands = []
      const _c0 = _raw.replace(/[《》「」\s]/g, '').replace(/把|写到|够|个|条|件|字|元/g, '')
      if (_c0) _cands.push(_c0)
      const _c1 = _c0.replace(/[0-9]+[万字条元件个]?/g, '')
      if (_c1 && _c1 !== _c0) _cands.push(_c1)
      const _m1 = _raw.match(/[《「]([^》」]+)[》」]/)
      if (_m1 && _m1[1]) _cands.push(_m1[1])
      const _c2 = _c0.slice(0, 3)
      if (_c2.length >= 2) _cands.push(_c2)
      const kwc = _cands.filter(function (x) { return x && x.length >= 2 })
      if (kwc.length) {
        const hits = Object.entries(g.nodes)
          .filter(function (kv) { return kwc.some(function (k) { return kv[0].includes(k) || String(kv[1].label).includes(k) }) })
          .map(function (kv) { return kv[0] })
        if (hits.length) {
          const rel = new Set()
          for (const e of g.edges) {
            if (hits.includes(e.from) && !isHub(e.to)) rel.add(e.to)
            if (hits.includes(e.to) && !isHub(e.from)) rel.add(e.from)
          }
          const labels = [...rel].slice(0, 4).map(id => g.nodes[id]?.label).filter(Boolean)
          if (labels.length) parts.push(`你脑子里顺带想到：${labels.join('、')}`)
        }
      }
    }
  } catch { }
  // 目标进度
  parts.push(`小说 ${novel.chars}/100000 字，视频 ${video.count}/100 条`)
  // 情绪（影响她怎么说话）
  parts.push(`此刻 energy ${Math.round(em.energy)} mood ${em.valence > 5 ? '还行' : em.valence < -5 ? '沉' : '一般'} stress ${Math.round(em.stress)}`)
  if (eff.reason.length) parts.push(`（${eff.reason.join('、')}，所以你说话${eff.speechLen < 0.85 ? '更短' : '正常'}，${eff.initiative < 0.5 ? '不太想主动' : '可以说'}）`)
  // 关系
  if (rel) parts.push(`对这个人：亲密度 ${rel.intimacy ?? '?'}，认识 ${rel.firstMetAt || '?'}`)
  // 未完成
  if ((m.pending || []).length) parts.push(`还有没做完的：${m.pending.map(p => p.what).slice(0, 3).join('、')}`)

  // 2026-11-11 加：说话手艺（常驻，简短，不占太多 token）
  //   完整版在 /opt/her/skills/怎么说话.md，这里只放最关键的 5 条
  parts.push('说话：不说「一定」「肯定」，说「大概」；允许烦和累；长度别都一样；说具体的事；留一半让人推')
  try { parts.push('你们最近：' + relationBrief()) } catch { }
  try { if (m.newsTake && m.newsTake.take) parts.push('你今天看新闻想到：' + m.newsTake.news + ' —— ' + m.newsTake.take) } catch { }

  return parts.join('。')
}

/* ══════════ CLI ══════════ */
const isMain = String(process.argv[1] || '').endsWith('her-mind.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'state'
  if (cmd === 'state') {
    const m = load()
    const novel = scanNovel()
    const video = scanVideos()
    const tokens = scanTokens()
    const eff = computeEffect(m.emotion)
    console.log('════ 她是谁 ════')
    console.log(' ', m.self.oneLine)
    console.log()
    console.log('════ 此刻 ════')
    console.log(`  注意力: ${m.focus.what || '（空）'}  ${m.focus.why ? '原因: ' + m.focus.why.slice(0, 50) : ''}`)
    console.log(`  情绪: energy ${Math.round(m.emotion.energy)} valence ${Math.round(m.emotion.valence)} stress ${Math.round(m.emotion.stress)}`)
    console.log(`  影响: 话长系数 ${eff.speechLen} 主动系数 ${eff.initiative} ${eff.reason.length ? '（' + eff.reason.join('、') + '）' : ''}`)
    console.log()
    console.log('════ 目标 ════')
    for (const g of m.goals) {
      const pct = Math.min(100, Math.round((g.current / g.target) * 1000) / 10)
      console.log(`  ${g.title}: ${g.current}/${g.target} ${g.unit} (${pct}%)`)
    }
    console.log()
    console.log('════ 最近反思 ════')
    if (!m.reflections?.length) console.log('  （还没反思过）')
    for (const r of (m.reflections || []).slice(-3)) console.log(`  ${r.at.slice(5, 16)} ${r.did} → 下一步 ${r.next}${r.shouldTell ? ' [想告诉他]' : ''}`)
    console.log()
    console.log('════ 今天 ════')
    console.log(`  做了 ${m.today.did.length} 件事  steps=${m.steps}`)
  } else if (cmd === 'tick') {
    const r = await tick({ dryRun: process.argv.includes('--dry') })
    console.log(JSON.stringify(r, null, 1))
  } else if (cmd === 'reflect') {
    const m = load()
    console.log(JSON.stringify(doReflect(m), null, 1))
  } else if (cmd === 'context') {
    console.log(context())
  } else console.log('用法: state | tick [--dry] | reflect | context')
}
