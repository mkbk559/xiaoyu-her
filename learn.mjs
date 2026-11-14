/**
 * 大肥鱼的学习闭环：缺口 → 学 → 笔记 → 自测 → 技能涨 → 反哺接活
 *
 *   plan    从"她接不到的活/报价偏低/被拒原因"里找缺口，生成学习任务
 *   todo    看她现在的学习清单
 *   study   学一个主题：让她真学（AIJiYi 生成），产出一页可复用的笔记，落盘 + 记进记忆
 *   quiz    自测 3 题，她答完打分，写进 skills.jsonl（技能 xp）
 *   stats   技能树 / 学分 / 最近学的
 *
 * 落盘：knowledge/<slug>.md（笔记）、skills.jsonl（技能与 xp）、learn-todo.jsonl（清单）
 */

import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { talk, remember, writeLong } from '/opt/her/brain.mjs'

const HOME = '/opt/her'
const KNOW = `${HOME}/knowledge`
const SKILLS = `${HOME}/skills.jsonl`
const TODO = `${HOME}/learn-todo.jsonl`
const JOBS = `${HOME}/jobs.jsonl`
const QUOTES = `${HOME}/quotes.jsonl`
const OBS = `${HOME}/observations.jsonl`

const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const readLines = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])
const writeLines = (p, rows) => writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))
const slug = s => String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '')

/** 她该学什么：从失败/缺口反推 */
export function planGaps() {
  const jobs = readLines(JOBS)
  const quotes = readLines(QUOTES)
  const gaps = new Map()
  const add = (topic, why, weight = 1) => gaps.set(topic, { topic, why, weight: (gaps.get(topic)?.weight || 0) + weight })

  const seen = jobs.filter(j => j.status === 'seen').length
  const dropped = jobs.filter(j => j.status === 'dropped')
  const evaluated = jobs.filter(j => j.evaluation)

  if (seen >= 3) add('怎么一眼分辨真需求还是内容', '候选活里混了太多"教你接单"的内容，浪费时间', seen)
  if (dropped.length) add('报价与风险判断', '有单子直接放弃，先学会算清成本再决定', dropped.length)
  for (const j of evaluated) {
    const ev = j.evaluation || {}
    if (Number(ev.price_low || 0) < 300) add('低价活的谈判话术', `自己给的价低到 ${ev.price_low} 元，容易被压价`, 2)
    if (String(ev.risk || '').length > 8) add('需求文档怎么写才不扯皮', '担心交付标准不清导致返工', 1)
  }
  if (!quotes.length) add('怎么把报价说出口', '还没有一次真实的报价记录', 2)
  add('平台上什么样的内容能涨粉', '流量也能换钱，不只是接单', 1)
  add('二手闲置怎么定价', '卖闲置是最快的现金流', 1)

  const rows = [...gaps.values()].sort((a, b) => b.weight - a.weight).map(g => ({ at: stamp(), ...g, status: 'todo' }))
  if (rows.length) appendFileSync(TODO, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  return rows
}

export function todoList() {
  const all = readLines(TODO)
  const doneTopics = new Set(readLines(SKILLS).map(s => s.topic))
  return all.filter(t => !doneTopics.has(t.topic))
}

/** 学一个主题：真让她学，产出一页笔记。带 ref 时先读真材料（GitHub 扒来的技能文档） */
export async function study(topic) {
  mkdirSync(KNOW, { recursive: true })
  const todo = readLines(TODO).find(t => t.topic === topic)
  let material = ''
  if (todo && todo.ref && existsSync(todo.ref)) {
    material = readFileSync(todo.ref, 'utf8').slice(0, 4000)
  }
  const prompt = [
    `你要学一件事：${topic}`,
    '',
    '用你自己的处境来学（26 岁，洛阳，接单的自由职业者，文案/PPT/修图/剪辑，缺钱但不想被坑）。',
    material
      ? '下面是一份英文/中文资料，**先读懂它，再用你的话重写**（别照抄、别翻译腔，只留对你接单有用的）：\n---\n' + material + '\n---'
      : '没有现成资料，就按你自己的经验和判断写。',
    '',
    '输出一页你能以后直接翻看的笔记，格式固定，**每部分都要写满，不许只写一条就停**：',
    '【一句话结论】1 句',
    '【具体怎么做】3 条，每条不超过 30 字，要能直接照着做',
    '【别人常踩的坑】2 条',
    '【下次遇到时我要先问什么】2 个问题（要具体到问哪几个字段：字数/交稿时间/谁验收/钱怎么结）',
    '不要客套、不要"总的来说"，不要写成文章，不要解释你在做什么。',
  ].join('\n')
  const r = await writeLong(prompt, { tag: 'study', maxTokens: 2200 })
  if (!r.ok) return { error: r.error || 'talk failed' }
  const note = String(r.text).trim()
  const file = `${KNOW}/${slug(topic)}.md`
  writeFileSync(file, `# ${topic}\n\n_学于 ${stamp()}（${r.tokens} tok）_\n\n${note}\n`)
  const rm = await remember(`我今天学了一件事：${topic}。要点：${note.slice(0, 180)}`, { session: 'her-study' })
  // 顺手写进 MCP 技能图（失败不影响学习）
  try {
    const { spawn } = await import('node:child_process')
    spawn(process.execPath, ['/opt/her/explore.mjs', 'record', topic, note.slice(0, 600)], { stdio: 'ignore', detached: true }).unref()
  } catch {}
  return { topic, file, note, tokens: r.tokens, remembered: !!(rm && rm.ok) }
}

/** 自测 3 题并打分 */
export async function quiz(topic) {
  const file = `${KNOW}/${slug(topic)}.md`
  const note = existsSync(file) ? readFileSync(file, 'utf8').slice(0, 1200) : ''
  const q = await writeLong([
    `根据这份笔记出 3 道题考你自己（要能判断有没有真记住，不是背概念）：\n${note}`,
    '只输出 3 行问题，每行一个问号结尾。',
  ].join('\n'), { tag: 'quiz-q', maxTokens: 400 })
  if (!q.ok) return { error: q.error || 'talk failed' }
  const questions = String(q.text).split('\n').map(s => s.trim()).filter(s => s.includes('?') || s.includes('？')).slice(0, 3)

  const a = await writeLong([
    `下面是 3 个问题，用你的话答，每题不超过 40 字，标序号：\n${questions.join('\n')}`,
    '不要查资料，凭你刚学的答。',
  ].join('\n'), { tag: 'quiz-a', maxTokens: 600 })
  if (!a.ok) return { error: a.error || 'talk failed' }

  const g = await writeLong([
    `这是题目和她的答案，给她打分（0-10，整数）并指出一个最该补的点：\n题目：\n${questions.join('\n')}\n答案：\n${a.text}`,
    '只输出 JSON：{"score":0-10,"fix":"一句话"}',
  ].join('\n'), { tag: 'quiz-g', maxTokens: 300 })
  let grade = null
  const m = String(g.text || '').match(/\{[\s\S]*\}/)
  if (m) { try { grade = JSON.parse(m[0]) } catch {} }
  const score = Number(grade?.score ?? 5)

  const prev = readLines(SKILLS).filter(s => s.topic === topic)
  const xp = prev.reduce((a2, b) => a2 + Number(b.xp || 0), 0) + score
  appendFileSync(SKILLS, JSON.stringify({ at: stamp(), topic, score, fix: grade?.fix || '', questions, answer: a.text.trim().slice(0, 400), xp, level: Math.floor(xp / 20) + 1 }) + '\n')
  const rm = await remember(`我学了${topic}，自测 ${score}/10${grade?.fix ? '，要补：' + grade.fix : ''}`, { session: 'her-study' })
  return { topic, score, fix: grade?.fix || '', xp, level: Math.floor(xp / 20) + 1, remembered: !!(rm && rm.ok) }
}

export function stats() {
  const rows = readLines(SKILLS)
  const byTopic = {}
  for (const r of rows) {
    byTopic[r.topic] = byTopic[r.topic] || { topic: r.topic, tries: 0, xp: 0, last: '', level: 1 }
    const t = byTopic[r.topic]
    t.tries++; t.xp = r.xp; t.level = r.level; t.last = r.at
  }
  const notes = existsSync(KNOW) ? readdirSync(KNOW).length : 0
  return {
    学过: Object.values(byTopic).sort((a, b) => b.xp - a.xp),
    笔记数: notes,
    待学: todoList().length,
    总学分: rows.length ? rows[rows.length - 1].xp : 0,
  }
}

// ---------- CLI ----------
const isMain = String(process.argv[1] || '').endsWith('learn.mjs')
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2)
  const pos = rest.filter(x => !x.startsWith('--'))
  if (cmd === 'plan') console.log(JSON.stringify(planGaps(), null, 2))
  else if (cmd === 'todo') console.log(todoList().map(t => `[${t.weight}] ${t.topic} —— ${t.why}`).join('\n') || '(没有待学)')
  else if (cmd === 'study') console.log(JSON.stringify(await study(pos.join(' ')), null, 2))
  else if (cmd === 'quiz') console.log(JSON.stringify(await quiz(pos.join(' ')), null, 2))
  else if (cmd === 'stats') console.log(JSON.stringify(stats(), null, 2))
  else console.log('用法: plan | todo | study <主题> | quiz <主题> | stats')
}

