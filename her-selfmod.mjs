#!/opt/node/bin/node
/**
 * her-selfmod.mjs —— 自改流水线骨架（2026-11-14 Step 3）
 *
 * 设计（按 ADR-070 / DGM 的最小可用版）：
 *   trigger  → 从因果经验里找"同因连续 ≥3 次失败"，或读用户口令文件 SELFMOD-REQ
 *   propose  → 生成改动提案（症状/证据/目标文件/改法草案/验收/回滚），可选去 GitHub 搜参考
 *   gate     → 沙盒验证：白名单校验 + 全部 .mjs node --check + 跑固定评测
 *   apply    → **故意不实现**：合入必须人工（见 policy 的 human_apply_only）
 *
 * 她永远不能改：her-arbiter / her-ops / her-verify / her-immune / gate / policy / 评测集
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const H = '/opt/her'
const SD = '/opt/her-selfmod'
const PROPS = SD + '/proposals'
const ARCH = SD + '/archive.json'
const TRIG = SD + '/triggers.jsonl'
const REQ = H + '/SELFMOD-REQ'
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const stampId = () => stamp().replace(/[-: ]/g, '').slice(0, 14)

function load(f, d) { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return d } }
function save(f, o) { writeFileSync(f, JSON.stringify(o, null, 2)) }
function appendJSONL(f, o) { appendFileSync(f, JSON.stringify(o) + '\n') }
function run(cmd, args, timeout = 120000) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout }).trim() } catch (e) { return String(e.stdout || e.message || '') }
}

mkdirSync(PROPS, { recursive: true })
const policy = load(H + '/her-selfmod-policy.json', { allowed: [], denied: [] })
const allowed = (f) => policy.allowed.some(p => f === p || f.startsWith(p)) && !policy.denied.some(p => f === p || f.startsWith(p))

const TARGET = { novel: 'write-novel.mjs', videos: 'daily-toon.mjs', learn: 'self-learn.mjs', chat: 'chat-server.mjs', graph: 'her-graph.mjs' }
const ADVICE = {
  '句式循环': '把提示词里的"长短句混写、每三句插动作"从软要求改成硬约束；生成后先自检短句密度，超阈值就重写一次。',
  '缺具体细节': '把具体词表从 9 个扩到按"当前作品"的词（暖手宝/印子/我妈/猫），并要求每 200 字至少一个物件或数字。',
  'quality': '把质量门失败原因反馈到提示词；重试次数 3 次太多，改成 2 次 + 换温度。',
  '超时': '减少单次 maxTokens / 拆分任务。',
  '参数错误': '在入口清洗坏词（已做），并把 aiji 错误落成标准错误码。',
}

function trigger() {
  const rows = existsSync(H + '/her-experience.jsonl')
    ? readFileSync(H + '/her-experience.jsonl', 'utf8').split('\n').filter(Boolean).slice(-300)
      .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    : []
  const prev = existsSync(TRIG)
    ? readFileSync(TRIG, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    : []
  const norm = (r) => String(r || '').indexOf('quality') >= 0 ? 'quality' : String(r || '').slice(0, 24)
  const recent = (goal, reason) => prev.some(t => {
    if (t.goal !== goal) return false
    if (norm(t.reason) !== norm(reason)) return false
    const ts = Date.parse(String(t.at || '').replace(' ', 'T') + '+08:00')
    return (Date.now() - ts) < 24 * 3600 * 1000
  })
  const found = []
  for (const goal of Object.keys(TARGET)) {
    const rs = rows.filter(r => r.goal === goal && r.type !== 'override')
    let run = 0
    let runReason = ''
    let best = null
    for (const r of rs) {
      if (r.skipped || String(r.reason || '').indexOf('跳过') === 0) continue
      if (r.ok) { run = 0; runReason = ''; continue }
      const nr = norm(r.reason)
      if (run > 0 && nr === runReason) run++
      else { run = 1; runReason = nr }
      if (run >= 3) best = { count: run, reason: nr, lastAt: r.at, sample: String(r.reason || '').slice(0, 80) }
    }
    if (best && !recent(goal, best.reason)) {
      found.push({ id: stampId() + '-' + goal, at: stamp(), kind: 'pain', goal, reason: best.reason,
                   count: best.count, lastAt: best.lastAt, sample: best.sample })
    }
  }
  if (existsSync(REQ)) {
    const want = readFileSync(REQ, 'utf8').trim().slice(0, 300)
    found.push({ id: stampId() + '-manual', at: stamp(), kind: 'manual', goal: 'manual', reason: want, count: 0 })
  }
  for (const t of found) appendJSONL(TRIG, t)
  console.log(JSON.stringify({ triggers: found, total: found.length }, null, 2))
  return found
}

function propose(id, search) {
  const list = existsSync(TRIG) ? readFileSync(TRIG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : []
  const t = list.slice().reverse().find(x => x.id === id)
  if (!t) { console.error('找不到 trigger: ' + id); process.exit(2) }
  const target = TARGET[t.goal] || 'her-mind.mjs'
  const okFile = allowed(target)
  const advice = ADVICE[Object.keys(ADVICE).find(k => String(t.reason).includes(k)) || ''] || '按证据改最小一处：先改提示词/参数，不动结构。'
  let refs = ''
  if (search) {
    const q = (t.goal + ' ' + t.reason).slice(0, 60)
    refs = run('/opt/node/bin/node', [H + '/gh-skill.mjs', 'search', q], 60000).slice(0, 1200)
  }
  const pid = 'prop-' + id
  const body = [
    '# 自改提案 ' + pid,
    '',
    '- 触发: ' + t.kind + ' | 目标: ' + t.goal + ' | 连续失败: ' + t.count,
    '- 原因: ' + t.reason,
    '- 目标文件: `' + target + '`' + (okFile ? '（白名单✅）' : '（**白名单外，禁止**❌）'),
    '- 生成时间: ' + stamp(),
    '',
    '## 证据',
    '```',
    JSON.stringify(t, null, 2),
    '```',
    '',
    '## 改法草案（最小改动）',
    advice,
    '',
    '## 搜索参考（GitHub）',
    refs ? '```\n' + refs + '\n```' : '（本次未搜索，用 --search 打开）',
    '',
    '## 验收',
    '1. `node --check ' + target + '`',
    '2. 跑固定评测：`node /opt/her-eval/eval.mjs`（novel 判定准确率必须 3/3，其余项不得退化）',
    '3. 连续 2 个 tick 灰度无回归',
    '',
    '## 回滚',
    '`git -C /opt/her revert <commit>`；评测不通过时 her-immune 会自动 revert',
    '',
    '## 人工闸',
    '本提案不会自动合入。合入前必须有人看过 diff；合入后用 `git commit -m "selfmod: ' + pid + '"` 打标记，免疫系统只对带 selfmod 标记的提交做自动回滚。',
  ].join('\n')
  const f = PROPS + '/' + pid + '.md'
  writeFileSync(f, body)
  const arch = load(ARCH, { proposals: [] })
  arch.proposals.push({ id: pid, at: stamp(), trigger: t, target, allowed: okFile, proposal: f, status: 'proposed' })
  save(ARCH, arch)
  console.log(JSON.stringify({ proposal: pid, file: f, target, allowed: okFile }, null, 2))
}

function gate(id) {
  const arch = load(ARCH, { proposals: [] })
  const p = arch.proposals.find(x => x.id === id)
  if (!p) { console.error('找不到提案: ' + id); process.exit(2) }
  const checks = []
  if (!p.allowed) checks.push({ name: 'policy', ok: false, why: '目标文件不在白名单' })
  else {
    const mjs = readdirSync(H).filter(f => f.endsWith('.mjs'))
    let bad = []
    for (const f of mjs) {
      try { execFileSync('/opt/node/bin/node', ['--check', H + '/' + f], { stdio: 'ignore', timeout: 30000 }) }
      catch { bad.push(f) }
    }
    checks.push({ name: 'syntax', ok: bad.length === 0, bad })
    const ev = run('/opt/node/bin/node', ['/opt/her-eval/eval.mjs'], 180000)
    let sc = {}
    try { sc = JSON.parse(readFileSync('/opt/her-eval/scorecard.json', 'utf8')) } catch { }
    checks.push({ name: 'eval', ok: !!sc.ok, fail: sc.fail || [] })
  }
  p.status = checks.every(c => c.ok) ? 'gate-passed' : 'gate-failed'
  p.gate = { at: stamp(), checks }
  save(ARCH, arch)
  console.log(JSON.stringify({ proposal: id, status: p.status, checks }, null, 2))
}

const cmd = process.argv[2] || 'help'
const arg = process.argv[3]
if (cmd === 'trigger') trigger()
else if (cmd === 'propose') propose(arg, process.argv.includes('--search'))
else if (cmd === 'gate') gate(arg)
else if (cmd === 'archive') {
  const a = load(ARCH, { proposals: [] })
  for (const p of a.proposals) console.log(p.at, p.id, p.status, p.target, p.allowed ? 'whitelisted' : 'BLOCKED')
  console.log('共 ' + a.proposals.length + ' 条')
}
else console.log('用法: trigger | propose <id> [--search] | gate <id> | archive')
