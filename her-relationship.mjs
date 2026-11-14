/**
 * 关系质量信号（2026-11-11，B 为主之后防自嗨）
 *
 * 为什么需要它：B 为主 = 没有阅读量/涨粉这种外部硬指标兜底。
 * 没有信号，她会越来越"顺着你说"，人格被磨平，而你看不出来。
 *
 * 三个数（只记趋势，不 KPI 化）：
 *   1. 你主动找她的频次（会话由谁发起）
 *   2. 她主动之后你的回应率
 *   3. 聊天轮次/时长的趋势
 *
 *   node her-relationship.mjs show     看趋势
 *   node her-relationship.mjs brief    一句话（喂给她的上下文）
 *   node her-relationship.mjs json     机器读
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs'

const HOME = '/opt/her'
const OUT = HOME + '/relation-signal.json'
const CHATS = HOME + '/chats'
const PROACTIVE = HOME + '/her-proactive.jsonl'
const SOUL = HOME + '/her-soul.json'
const QUEUE = HOME + '/her-proactive-queue.jsonl'
const ALERTS = HOME + '/her-alerts.jsonl'

const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const dayOf = s => String(s || '').slice(0, 10)
const hourOf = s => {
  const t = Date.parse(String(s || '').replace(' ', 'T') + '+08:00')
  return Number.isFinite(t) ? t : null
}
const readJSON = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }
const readLines = p => {
  try {
    return readFileSync(p, 'utf8').split(String.fromCharCode(10)).filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

function soulUser() {
  const s = readJSON(SOUL, {})
  return Object.keys(s.relations || {})[0] || '2216608312'
}

function allChats(days = 14) {
  const out = []
  if (!existsSync(CHATS)) return out
  for (const f of readdirSync(CHATS).sort()) {
    if (!f.endsWith('.jsonl')) continue
    for (const r of readLines(CHATS + '/' + f)) out.push(r)
  }
  const cut = Date.now() - days * 86400000
  return out.filter(r => { const t = hourOf(r.at); return t && t >= cut })
}

/** 一天的聊天事实 */
function dayStats(chatRows, proactives, day, user) {
  const rows = chatRows.filter(r => dayOf(r.at) === day)
  const userMsgs = rows.filter(r => String(r.qq) === String(user)).length
  const herMsgs = rows.length - userMsgs
  // 会话：间隔 > 30 分钟的算新会话
  let sessions = 0, userInitiated = 0
  let lastT = null
  for (const r of rows) {
    const t = hourOf(r.at)
    if (!t) continue
    if (lastT === null || t - lastT > 30 * 60000) {
      sessions++
      if (String(r.qq) === String(user)) userInitiated++
    }
    lastT = t
  }
  const p = proactives.filter(x => dayOf(x.at) === day && x.type === 'proactive')
  const replied = p.filter(x => x.repliedAt)
  return {
    day, userMsgs, herMsgs, sessions, userInitiated,
    herProactive: p.length,
    proactiveReplied: replied.length,
    proactiveReplyRate: p.length ? Math.round((replied.length / p.length) * 100) : null,
  }
}

function signal() {
  const user = soulUser()
  const chats = allChats(14)
  const proactives = readLines(PROACTIVE)
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + 8 * 3600 * 1000 - i * 86400000).toISOString().slice(0, 10)
    days.push(dayStats(chats, proactives, d, user))
  }
  const last3 = days.slice(-3)
  const prev4 = days.slice(0, 4)
  const sum = (arr, k) => arr.reduce((a, b) => a + (b[k] || 0), 0)
  const trend = {
    userInitiated: days.map(d => d.userInitiated),
    herProactive: days.map(d => d.herProactive),
    chatRows: days.map(d => d.userMsgs + d.herMsgs),
    proactiveReplyRate7d: (() => {
      const sent = sum(days, 'herProactive')
      const rep = sum(days, 'proactiveReplied')
      return sent ? Math.round((rep / sent) * 100) : null
    })(),
  }
  const flags = []
  const ui3 = sum(last3, 'userInitiated'), ui4 = sum(prev4, 'userInitiated')
  if (ui4 >= 3 && ui3 <= ui4 * 0.6) flags.push('user-drift: 你主动找她的次数在掉（' + ui4 + ' → ' + ui3 + '）')
  const sent7 = sum(days, 'herProactive'), rep7 = sum(days, 'proactiveReplied')
  if (sent7 >= 3 && rep7 / sent7 < 0.5) flags.push('proactive-ignored: 她主动 ' + sent7 + ' 次，你只回了 ' + rep7 + ' 次')
  const chat3 = sum(last3, 'chatRows'), chat4 = sum(prev4, 'chatRows')
  if (chat4 >= 10 && chat3 <= chat4 * 0.5) flags.push('chat-cooling: 聊天量在掉（' + chat4 + ' → ' + chat3 + '）')
  const dataDays = days.filter(d => (d.userMsgs + d.herMsgs) > 0).length
  const out = {
    at: stamp(),
    warmup: dataDays < 7,
    dataDays,
    user,
    days,
    trend,
    flags,
    healthy: flags.length === 0,
  }
  return out
}

/** 一句话：给她的聊天上下文用（别让她看到机制，只让她知道"人"） */
function brief(sig = null) {
  const s = sig || signal()
  const today = s.days[s.days.length - 1]
  const y = s.days[s.days.length - 2]
  const bits = []
  bits.push('今天聊了 ' + (today.userMsgs + today.herMsgs) + ' 句' + (today.userInitiated ? '（他先开口 ' + today.userInitiated + ' 次）' : ''))
  if (y && (y.userMsgs + y.herMsgs)) bits.push('昨天 ' + (y.userMsgs + y.herMsgs) + ' 句')
  if (s.trend.proactiveReplyRate7d !== null) bits.push('你主动的回应率 ' + s.trend.proactiveReplyRate7d + '%')
  return bits.join('；')
}

/** 内核用：现在的关系状态（判断要不要主动/维护） */
function quickRelation() {
  const s = signal()
  const proactives = readLines(PROACTIVE).filter(x => x.type === 'proactive')
  const chats = allChats(3)
  const now = Date.now()
  const lastUser = [...chats].reverse().find(r => String(r.qq) === String(s.user))
  const lastPro = [...proactives].reverse()[0]
  const today = stamp().slice(0, 10)
  return {
    user: s.user,
    flags: s.flags,
    healthy: s.healthy,
    todayUserMsgs: chats.filter(r => dayOf(r.at) === today && String(r.qq) === String(s.user)).length,
    todayHerMsgs: chats.filter(r => dayOf(r.at) === today && String(r.qq) !== String(s.user)).length,
    hoursSinceUser: lastUser ? (now - (hourOf(lastUser.at) || now)) / 3600000 : 999,
    proactiveToday: proactives.filter(x => dayOf(x.at) === today).length,
    lastProactiveAt: lastPro ? lastPro.at : null,
    hoursSinceProactive: lastPro ? (now - (hourOf(lastPro.at) || now)) / 3600000 : 999,
    proactiveReplyRate7d: s.trend.proactiveReplyRate7d,
  }
}

/** 内核用：把"想找他说话"的由头放进队列，由桥决定发不发（桥有 40 分钟/4 条护栏） */
function pushProactiveRequest(req) {
  try {
    const row = { at: stamp(), kind: req.kind || 'reach', hook: String(req.hook || '').slice(0, 120), why: String(req.why || '').slice(0, 80) }
    appendFileSync(QUEUE, JSON.stringify(row) + String.fromCharCode(10))
    return true
  } catch { return false }
}

function writeSignal(s) {
  try { writeFileSync(OUT, JSON.stringify(s, null, 1)) } catch { }
  try {
    if (!s.healthy && !s.warmup) {
      appendFileSync(ALERTS, JSON.stringify({ at: stamp(), level: 'medium', code: 'relation-signal', message: s.flags.join('; '), action: 'warn' }) + String.fromCharCode(10))
    }
  } catch { }
}

const isMain = String(process.argv[1] || '').endsWith('her-relationship.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'show'
  const s = signal()
  writeSignal(s)
  if (cmd === 'brief') console.log(brief(s))
  else if (cmd === 'json') console.log(JSON.stringify(s, null, 1))
  else {
    console.log('=== 关系信号 ===')
    for (const d of s.days) {
      console.log(d.day + '  你 ' + d.userMsgs + ' 句 / 她 ' + d.herMsgs + ' 句 / 会话 ' + d.sessions + '（你先开口 ' + d.userInitiated + '） / 她主动 ' + d.herProactive + ' 次，回了 ' + d.proactiveReplied)
    }
    console.log()
    console.log('7 天：你主动找她 ' + s.trend.userInitiated.reduce((a, b) => a + b, 0) + ' 次 | 她主动后你的回应率 ' + s.trend.proactiveReplyRate7d + '%')
    console.log('状态：' + (s.healthy ? '健康' : s.flags.join(' | ')))
    console.log('一句话：' + brief(s))
  }
}

export { signal, brief, quickRelation, pushProactiveRequest, writeSignal }
