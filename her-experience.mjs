/**
 * 因果经验（2026-11-13 Step 2）
 *
 * 读 /opt/her/her-experience.jsonl（her-mind 每个动作后追加），回答一个问题：
 *   「这个目标是不是连续栽在同一个原因上？」
 * 连续 >=3 次同因失败 → overrideFor() 给一条「换法」建议。
 * 只读 + 纯函数，不改任何状态，方便单测。
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs'

const HOME = '/opt/her'
export const EXP = HOME + '/her-experience.jsonl'

export function load(n = 80) {
  try {
    if (!existsSync(EXP)) return []
    return readFileSync(EXP, 'utf8').split('\n').filter(Boolean).slice(-n)
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

/** 原因归类（同因才算同因） */
export function normReason(reason) {
  const s = String(reason || '')
  if (s.indexOf('句式循环') >= 0) return '句式循环'
  if (s.indexOf('缺具体细节') >= 0) return '缺具体细节'
  if (s.indexOf('quality') >= 0) return 'quality'
  if (s.indexOf('超时') >= 0 || s.indexOf('timeout') >= 0 || s.indexOf('Timeout') >= 0) return '超时'
  if (s.indexOf('参数错误') >= 0) return '参数错误'
  return s.replace(/[0-9:：%（）()]/g, '').slice(0, 24).trim()
}

/** 从最新往回数：同一目标连续失败几次、都是什么原因 */
export function failsStreak(goalId, n = 80) {
  const rows = load(n).filter(r => r && r.goal === goalId && r.type !== 'override')
  let count = 0
  const reasons = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.ok) break
    count++
    reasons.push(normReason(r.reason))
  }
  const tally = {}
  for (const x of reasons) tally[x] = (tally[x] || 0) + 1
  let top = ''
  let topN = 0
  for (const k of Object.keys(tally)) if (tally[k] > topN) { top = k; topN = tally[k] }
  return { count, reason: top, reasons, lastAt: rows.length ? rows[rows.length - 1].at : '' }
}

const HINTS = {
  '句式循环': '这次长短句混着写，每三句插一个动作或一句对话；别连着甩短句。',
  '缺具体细节': '这次多写具体的东西：钱数、物件、声音、手上的温度；别只写心理。',
  'quality': '换个写法：先把场景里一件具体的东西写清楚，再往下走。',
  '超时': '这次少写点，六百字左右收住，别拖。',
  '参数错误': '换个入口再来一次，别重复原样重发。',
}

/** 连续 >=3 次同因失败 → 给 override；否则 null */
export function overrideFor(goalId) {
  const s = failsStreak(goalId)
  if (s.count < 3) return null
  const hint = HINTS[s.reason] || '换个做法，别照上次的路子走。'
  return { goal: goalId, count: s.count, reason: s.reason, hint }
}

/** 2026-11-13 Step2-2C：读计划段写下的 override 提示（读过即消费）
 *  goal 不匹配就不消费（留给对应的执行器） */
export function readPlanHint(goal) {
  const hp = HOME + '/her-plan-hint.json'
  try {
    if (!existsSync(hp)) return ''
    const h = JSON.parse(readFileSync(hp, 'utf8'))
    if (goal && h.goal && h.goal !== goal) return ''
    try { unlinkSync(hp) } catch (e) { }
    return String(h.hint || '')
  } catch { return '' }
}

const isMain = String(process.argv[1] || '').endsWith('her-experience.mjs')
if (isMain) {
  const goal = process.argv[2] || 'novel'
  console.log(JSON.stringify({ goal, streak: failsStreak(goal), override: overrideFor(goal) }, null, 2))
}
