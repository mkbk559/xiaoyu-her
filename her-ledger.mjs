/**
 * 她的真实账本 —— 全部用 token（2026-11-10）
 *
 * 用户两句话定死了这件事：
 *   1.「其实她真实使用的钱是 token」
 *   2.「但是全部换成 token」
 *
 * 所以：
 *   · 她的"钱" = token 余额，不是人民币
 *   · 花钱 = 调用大模型（看图、说话、出片、学习）
 *   · 赚钱 = 用户充值（或者她产出内容换来的额度）
 *   · 她的"穷" = token 快见底，不敢多干活
 *
 * 数据源：/opt/her/brain-usage.jsonl（每次调用的真实 token 消耗）
 *
 *   node her-ledger.mjs balance        现在多少 token
 *   node her-ledger.mjs sync           把账本消耗写进 ledger-token.jsonl
 *   node her-ledger.mjs recent [n]     最近 n 条
 *   node her-ledger.mjs topup <n> [备注]  充值（用户给她的额度）
 *   node her-ledger.mjs stats          按用途分解
 *   node her-ledger.mjs mirror         把余额写回 world.json（她的"现金"就是 token）
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'

const HOME = '/opt/her'
const LEDGER = `${HOME}/ledger-token.jsonl`      // token 账本
const USAGE = `${HOME}/brain-usage.jsonl`        // 真实调用记录
const WORLD = `${HOME}/world.json`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const today = () => stamp().slice(0, 10)

/** 建账：初始额度 */
const INIT_TOKENS = 3000000        // 开局给 300 万 token（约能撑 15 天正常干活）
const DEFAULT = {
  createdAt: '2026-11-10',
  initTokens: INIT_TOKENS,
  note: '她的钱是 token。开局 300 万，用完就得省。',
}

function readLines(p) {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/** 真实消耗：按 brain-usage 统计（去重：已经同步过的记到最后一条时间之后） */
function realSpend() {
  const rows = readLines(USAGE)
  // 2026-11-11 补：只重算最近 7 天（历史由一次性核算脚本处理，别让 tick 随账本变长越跑越慢）
  const cutoff = new Date(Date.now() + 8 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10)
  for (const d of Object.keys(byDay)) { if (d < cutoff) delete byDay[d] }

  const ledger = readLines(LEDGER)
  const lastSync = ledger.filter(r => r.type === 'spend').map(r => r.at).sort().pop() || ''
  const fresh = rows.filter(r => String(r.at || '') > lastSync && (r.tokens || 0) > 0)
  const total = fresh.reduce((a, r) => a + (r.tokens || 0), 0)
  const byTag = {}
  for (const r of fresh) byTag[r.tag || '?'] = (byTag[r.tag || '?'] || 0) + (r.tokens || 0)
  return { rows: fresh, total, byTag, lastAt: fresh.length ? fresh[fresh.length - 1].at : '' }
}

function initIfNeeded() {
  if (existsSync(LEDGER)) return
  writeFileSync(LEDGER, JSON.stringify({ at: '2026-11-10 00:00:00', type: 'init', amount: INIT_TOKENS, note: '开局 token 额度' }) + '\n')
  console.log(`已建账：开局 ${INIT_TOKENS.toLocaleString()} token`)
}

function balance() {
  const rows = readLines(LEDGER)
  let tokens = 0, spent = 0, topped = 0
  const byTag = {}
  let firstSpendDay = '', lastSpendDay = ''
  for (const r of rows) {
    const a = Number(r.amount) || 0
    const d = String(r.at || '').slice(0, 10)
    if (r.type === 'init') { tokens += a }
    else if (r.type === 'topup') { tokens += a; topped += a }
    else if (r.type === 'spend') {
      tokens -= a; spent += a
      if (!firstSpendDay || d < firstSpendDay) firstSpendDay = d
      if (!lastSpendDay || d > lastSpendDay) lastSpendDay = d
      // note 形如 "speak:9697,see:266836"
      for (const part of String(r.note || '').split(',')) {
        const [k, v] = part.split(':')
        if (k && v) byTag[k.trim()] = (byTag[k.trim()] || 0) + (Number(v) || 0)
      }
    }
  }
  // 天数 = 真实消耗跨了多少天（不是条目数）
  const daySpan = (firstSpendDay && lastSpendDay)
    ? Math.max(1, Math.round((new Date(lastSpendDay) - new Date(firstSpendDay)) / 86400000) + 1)
    : 1
  const dailyAvg = spent / daySpan
  return {
    unit: 'token',
    left: Math.round(tokens),
    init: INIT_TOKENS,
    toppedUp: Math.round(topped),
    spent: Math.round(spent),
    dailyAvg: Math.round(dailyAvg),
    daysLeft: dailyAvg > 0 ? Math.round(tokens / dailyAvg) : '∞',
    spanDays: daySpan,
    firstSpendDay, lastSpendDay,
    entries: rows.length,
    topTags: Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ tag: k, tokens: Math.round(v) })),
  }
}

/** 把还没记账的真实消耗补进来（按天聚合，一天一条） */
function sync() {
  // 2026-11-11 修（对账发现）：
  //   旧实现是"增量 + 写入未来时间戳 at=day 23:59:59"→ 当天 sync 之后产生的调用
  //   永远小于该时间戳，下一次 sync 会被过滤掉（11-10 丢 3220 token 就是这个）。
  //   改成**按天 upsert**：从 brain-usage 重算每天的总量，替换账本里同一天的 spend 行。
  //   同一天跑 N 次结果相同（幂等），不会产生重复行。
  const rows = readLines(USAGE).filter(r => r.at && (Number(r.tokens) || 0) > 0)
  const byDay = {}
  for (const r of rows) {
    const d = String(r.at).slice(0, 10)
    const t = Number(r.tokens) || 0
    const tag = r.tag || '?'
    if (!byDay[d]) byDay[d] = { total: 0, calls: 0, byTag: {} }
    byDay[d].total += t
    byDay[d].calls += 1
    byDay[d].byTag[tag] = (byDay[d].byTag[tag] || 0) + t
  }
  const ledger = readLines(LEDGER)
  const others = ledger.filter(r => r.type !== 'spend')
  const spendByDay = {}
  for (const r of ledger) {
    if (r.type !== 'spend') continue
    const d = r.day || String(r.at || '').slice(0, 10)
    spendByDay[d] = r
  }
  let changed = 0
  let sum = 0
  for (const d of Object.keys(byDay).sort()) {
    const v = byDay[d]
    const top = Object.entries(v.byTag).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const row = {
      at: d + ' 23:59:59', type: 'spend', amount: Math.round(v.total),
      note: top.map(([k, n]) => k + ':' + Math.round(n)).join(','),
      calls: v.calls, day: d,
    }
    const old = spendByDay[d]
    if (!old || Number(old.amount) !== row.amount || Number(old.calls) !== row.calls) changed += 1
    spendByDay[d] = row
    sum += v.total
  }
  const merged = others.concat(Object.keys(spendByDay).sort().map(d => spendByDay[d]))
  if (changed > 0) writeFileSync(LEDGER, merged.map(r => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10))
  console.log('记账同步：' + Object.keys(byDay).length + ' 天，合计 ' + Math.round(sum).toLocaleString() + ' token，变更 ' + changed + ' 行')
  return sum
}

/** 充值 */
function topup(n, note) {
  const amt = Math.abs(Number(n) || 0)
  if (!amt) { console.log('充值要写数字'); process.exit(1) }
  appendFileSync(LEDGER, JSON.stringify({ at: stamp(), type: 'topup', amount: amt, note: String(note || '用户充值') }) + '\n')
  console.log(`充值 ${amt.toLocaleString()} token：${note || '用户充值'}`)
  return amt
}

/** 把 token 余额写回 world.json（她的"现金"就是 token） */
function mirror() {
  const b = balance()
  if (!existsSync(WORLD)) { console.log('没有 world.json'); return }
  const w = JSON.parse(readFileSync(WORLD, 'utf8'))
  const before = w.cash
  w.cash = b.left               // 现金 = token 余额
  w.cashUnit = 'token'
  w.tokensLeft = b.left
  w.tokensSpent = b.spent
  w.daysLeft = b.daysLeft
  w.ledgerAt = stamp()
  writeFileSync(WORLD, JSON.stringify(w, null, 2))
  console.log(`world.json 现金: ${before} → ${b.left} token（还能撑 ${b.daysLeft} 天）`)
}

const cmd = process.argv[2] || 'balance'

if (cmd === 'balance') {
  initIfNeeded(); sync(); mirror()
  const b = balance()
  console.log(JSON.stringify(b, null, 1))
  console.log(`\n还剩 ${b.left.toLocaleString()} token，按当前速度能撑 ${b.daysLeft} 天`)
} else if (cmd === 'sync') {
  initIfNeeded(); sync()
} else if (cmd === 'topup') {
  initIfNeeded(); topup(process.argv[3], process.argv[4]); mirror()
} else if (cmd === 'mirror') {
  initIfNeeded(); mirror()
} else if (cmd === 'recent') {
  initIfNeeded()
  const n = Number(process.argv[3]) || 12
  for (const r of readLines(LEDGER).slice(-n)) {
    const sign = r.type === 'spend' ? '-' : '+'
    console.log(`  ${String(r.at).slice(0, 16)}  ${r.type.padEnd(7)} ${sign}${(Number(r.amount) || 0).toLocaleString()}  ${(r.note || '').slice(0, 60)}`)
  }
} else if (cmd === 'stats') {
  initIfNeeded(); sync()
  const b = balance()
  console.log('token 账本：')
  console.log(`  开局 ${b.init.toLocaleString()} + ${b.toppedUp.toLocaleString()} 充值`)
  console.log(`  已花 ${b.spent.toLocaleString()}`)
  console.log(`  剩   ${b.left.toLocaleString()}  token（${b.daysLeft} 天）`)
  console.log(`  日均消耗 ${b.dailyAvg.toLocaleString()} token`)
  console.log('  按用途：')
  for (const t of b.topTags) console.log(`    ${t.tag.padEnd(24)} ${t.tokens.toLocaleString()}`)
} else console.log('用法: balance | sync | topup <n> [备注] | mirror | recent [n] | stats')
