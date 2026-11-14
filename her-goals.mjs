/**
 * 她的目标 / 技能 / token（2026-11-10）
 *
 * 抄的是 DSH 三个插件的**思想**，不是代码：
 *   dsh-goal        → 长期目标驱动，做事自动推进
 *   dsh-skill       → 技能可查看、可增长
 *   dsh-token-meter → 随时知道还剩多少能干活
 *
 * 铁律：**所有数字都从真实文件算出来**，不许手填。
 *   小说字数  ← /opt/her/novel/正文/*.md 实际字数
 *   视频条数  ← /opt/her/toon-episodes/*.mp4 实际个数
 *   token     ← /opt/her/ledger-token.jsonl 真实账本
 *   技能      ← /opt/her/skills.jsonl 真实学习记录
 *
 *   node her-goals.mjs show        看目标进度
 *   node her-goals.mjs sync        从真实文件刷新进度
 *   node her-goals.mjs tell        生成一段"她对自己进度的认知"（喂给 AIJiYi）
 *   node her-goals.mjs skills      看技能
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'

const HOME = '/opt/her'
const GOALS = `${HOME}/her-goals.json`
const SKILLS = `${HOME}/skills.jsonl`
const LEDGER = `${HOME}/ledger-token.jsonl`
const USAGE = `${HOME}/brain-usage.jsonl`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/* ── 真实产出统计（数据源同 her-mind，仅手动查看用，不是第二份真相） ── */
function scanNovel() {
  const dir = `${HOME}/novel/正文`
  if (!existsSync(dir)) return { chars: 0, files: 0, lastAt: '' }
  const fs = readdirSync(dir).filter(f => f.endsWith('.md'))
  let chars = 0
  let lastAt = 0
  for (const f of fs) {
    try {
      chars += readFileSync(`${dir}/${f}`, 'utf8').replace(/\s/g, '').length
      lastAt = Math.max(lastAt, statSync(`${dir}/${f}`).mtimeMs)
    } catch { }
  }
  return { chars, files: fs.length, lastAt: lastAt ? new Date(lastAt + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : '' }
}

function scanVideos() {
  const dir = `${HOME}/toon-episodes`
  if (!existsSync(dir)) return { count: 0, lastAt: '' }
  const fs = readdirSync(dir).filter(f => f.endsWith('.mp4'))
  let lastAt = 0
  for (const f of fs) { try { lastAt = Math.max(lastAt, statSync(`${dir}/${f}`).mtimeMs) } catch { } }
  return { count: fs.length, lastAt: lastAt ? new Date(lastAt + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : '' }
}

function scanTokens() {
  if (!existsSync(LEDGER)) return { left: 0, spent: 0 }
  const rows = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  let left = 0, spent = 0
  for (const r of rows) {
    const a = Number(r.amount) || 0
    if (r.type === 'init' || r.type === 'topup') left += a
    else if (r.type === 'spend') { left -= a; spent += a }
  }
  return { left: Math.max(0, left), spent }
}

/* ── 技能：从 skills.jsonl 汇总 ── */
const SKILL_NAMES = ['文案', 'PPT', '修图', '剪辑', '设计', '视频', '小说', '学习']

function scanSkills() {
  const out = {}
  if (!existsSync(SKILLS)) return out
  const rows = readFileSync(SKILLS, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  for (const r of rows) {
    const topic = String(r.topic || '')
    const score = Number(r.score) || 0
    for (const name of SKILL_NAMES) {
      if (topic.includes(name)) {
        if (!out[name]) out[name] = { name, best: 0, attempts: 0, lastTopic: '', lastAt: '' }
        out[name].attempts++
        out[name].best = Math.max(out[name].best, score)
        out[name].lastTopic = topic.slice(0, 40)
        out[name].lastAt = String(r.at || '').slice(0, 16)
      }
    }
  }
  return out
}

/* ── 目标定义 ── */
function defaultGoals() {
  return {
    createdAt: stamp(),
    goals: [
      {
        id: 'novel', title: '把《陈默》写到 10 万字',
        target: 100000, unit: '字', source: 'novel',
        why: '她写了三个月，编辑说节奏太慢。她想写完。',
      },
      {
        id: 'videos', title: '发够 100 条视频',
        target: 100, unit: '条', source: 'video',
        why: '自媒体是她的主业，一天一条。',
      },
      {
        id: 'sea', title: '攒够看海的钱',
        target: 2300, unit: '元', source: 'fixed', fixed: 2300,
        why: '攒了两年只攒到 2300，一直没去。',
      },
    ],
    history: [],
  }
}

function loadGoals() {
  // 2026-11-11 修：her-mind.json 的 goals 是唯一真相（4个目标）。
  // her-goals.json 是旧的独立副本（只有3个，缺 cat），两边不一致会困惑用户。
  // 现在优先读 her-mind.json，读不到才用 her-goals.json。
  const MIND = `${HOME}/her-mind.json`
  if (existsSync(MIND)) {
    try {
      const m = JSON.parse(readFileSync(MIND, 'utf8'))
      if (Array.isArray(m.goals) && m.goals.length) {
        return { goals: m.goals, history: m.completedGoals || [], source: 'her-mind.json' }
      }
    } catch { }
  }
  if (!existsSync(GOALS)) { const g = defaultGoals(); writeFileSync(GOALS, JSON.stringify(g, null, 2)); return g }
  try { return JSON.parse(readFileSync(GOALS, 'utf8')) } catch { return defaultGoals() }
}
function saveGoals(g) {
  // 2026-11-11：如果来源是 her-mind.json，不回写（避免覆盖内核数据）
  if (g.source === 'her-mind.json') return
  writeFileSync(GOALS, JSON.stringify(g, null, 2))
}

/* ── 同步：从真实文件刷新进度 ── */
function sync() {
  const g = loadGoals()
  const novel = scanNovel()
  const video = scanVideos()
  const now = stamp()

  for (const goal of g.goals) {
    const before = Number(goal.current) || 0
    let cur = before
    if (goal.source === 'novel') cur = novel.chars
    else if (goal.source === 'video') cur = video.count
    else if (goal.source === 'fixed') cur = goal.fixed
    goal.current = cur
    goal.updatedAt = now
    if (cur !== before) {
      g.history = [...(g.history || []), { at: now, id: goal.id, from: before, to: cur }].slice(-200)
    }
    goal.percent = Math.min(100, Math.round((cur / goal.target) * 1000) / 10)
  }
  saveGoals(g)
  return { g, novel, video, tokens: scanTokens() }
}

/* ── 给她自己看的"进度认知"（喂给 AIJiYi，让她说的是真的） ── */
function tellText() {
  const { g, novel, video, tokens } = sync()
  const lines = []
  for (const goal of g.goals) {
    const pct = goal.percent
    if (goal.id === 'novel') {
      lines.push(`小说《陈默》现在 ${goal.current} 字，目标 ${goal.target} 字（${pct}%）`)
    } else if (goal.id === 'videos') {
      lines.push(`视频发了 ${goal.current} 条，目标 ${goal.target} 条（${pct}%）`)
    } else if (goal.id === 'sea') {
      lines.push(`攒着看海的钱 ${goal.current} 元（目标 ${goal.target}）`)
    }
  }
  lines.push(`手上还剩 ${tokens.left.toLocaleString()} token`)
  return lines.join('；')
}

/* ── CLI ── */
const isMain = String(process.argv[1] || '').endsWith('her-goals.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'show'
  if (cmd === 'show') {
    const { g, novel, video, tokens } = sync()
    console.log('════ 她的目标 ════')
    for (const goal of g.goals) {
      const bar = '█'.repeat(Math.round(goal.percent / 5)) + '░'.repeat(20 - Math.round(goal.percent / 5))
      console.log(`  ${goal.title}`)
      console.log(`    ${bar} ${goal.current}/${goal.target} ${goal.unit}（${goal.percent}%）`)
    }
    console.log()
    console.log('════ 真实产出 ════')
    console.log(`  小说 ${novel.files} 篇 / ${novel.chars} 字   最后 ${novel.lastAt || '-'}`)
    console.log(`  视频 ${video.count} 条   最后 ${video.lastAt || '-'}`)
    console.log(`  token 剩 ${tokens.left.toLocaleString()}（已花 ${tokens.spent.toLocaleString()}）`)
  } else if (cmd === 'sync') {
    const { g } = sync()
    console.log(JSON.stringify(g.goals.map(x => ({ id: x.id, cur: x.current, target: x.target, pct: x.percent })), null, 1))
  } else if (cmd === 'tell') {
    console.log(tellText())
  } else if (cmd === 'skills') {
    const sk = scanSkills()
    console.log('════ 她的技能（从 skills.jsonl 汇总）════')
    if (!Object.keys(sk).length) { console.log('  还没记录'); process.exit(0) }
    for (const s of Object.values(sk).sort((a, b) => b.best - a.best)) {
      console.log(`  ${s.name.padEnd(6)} 最好 ${s.best}/10  练了 ${s.attempts} 次  最近「${s.lastTopic}」`)
    }
  } else console.log('用法: show | sync | tell | skills')
}

export { sync, tellText, scanNovel, scanVideos, scanTokens, scanSkills, loadGoals }
