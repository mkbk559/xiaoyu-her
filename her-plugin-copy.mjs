/**
 * 从 DSH 插件抄的两个模块（2026-11-10）
 *
 * 用户：「去抄」
 *
 * 抄自（读的是 node_modules 里的源码）：
 *   @deepseek-ai/dsh-token-meter/lib/types/estimate.js
 *     → CHARS_PER_TOKEN=4 / BLOCK_OVERHEAD=4 / ROLE_OVERHEAD=4
 *   @deepseek-ai/dsh-goal/lib/types/fold.js
 *     → 目标状态机：phase(active/paused/blocked/complete) + blockedReason(code,message)
 *       + maxGoalRounds + revision
 *   @deepseek-ai/dsh-session-stats/lib/types/projection.js
 *     → 观测字段：turns/steps/llmMs/toolMs/ttftMs/decodeMs/decodeTokens
 *
 * 用途：
 *   estimateTokens()  不调模型先算成本（P0-1 成本上限）
 *   goalPhase()       目标状态机（P1 目标冲突/失败恢复）
 *   statsFold()       可观测指标（P0-2）
 */

/* ══════ 抄自 dsh-token-meter/estimate.js ══════ */
export const CHARS_PER_TOKEN = 4      // 固定文本密度
export const BLOCK_OVERHEAD = 4       // 每块结构开销
export const ROLE_OVERHEAD = 4        // 每条消息角色开销

/** 估算一段文字的 token（照抄 estimateContent 的 text 分支） */
export function estimateTextTokens(text) {
  const s = String(text || '')
  if (!s) return 0
  return Math.ceil(s.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

/** 估算一次 chat 请求的 token（system + messages + 输出预留） */
export function estimateRequestTokens({ system = '', messages = [], maxOutput = 800 } = {}) {
  let t = 0
  if (system) t += estimateTextTokens(system) + ROLE_OVERHEAD
  for (const m of messages) {
    t += estimateTextTokens(m.content || '') + ROLE_OVERHEAD
  }
  t += Math.ceil(maxOutput / 1)   // 预留输出
  return t
}

/* ══════ 抄自 dsh-goal/fold.js 的目标状态机 ══════ */
export const GOAL_PHASES = ['active', 'paused', 'blocked', 'complete']

/** 合法的 blockedReason：code 必须 lower-kebab-case，message 非空且已 normalize */
export function validBlockedReason(r) {
  if (!r || typeof r !== 'object') return false
  const keys = Object.keys(r).sort().join(',')
  if (keys !== 'code,message') return false
  if (typeof r.code !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(r.code)) return false
  if (typeof r.message !== 'string' || !r.message.trim() || r.message !== r.message.trim()) return false
  return true
}

/** 目标该不该被选中：只有 active 的才参与调度 */
export function isSelectable(goal) {
  if (!goal) return false
  const phase = goal.phase || 'active'
  return phase === 'active'
}

/** 目标轮次是否已用完（照抄 maxGoalRounds 的语义） */
export function roundsExhausted(goal) {
  if (!goal) return true
  const max = Number(goal.maxGoalRounds || 0)
  if (!max) return false
  return Number(goal.roundsStarted || 0) >= max
}

/** 造一个标准的 blocked 原因 */
export function blockedReason(code, message) {
  return { code: String(code || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, '-'), message: String(message || '').trim() || '未知原因' }
}

/* ══════ 抄自 dsh-session-stats/projection.js 的观测字段 ══════ */
export function emptyStats() {
  return {
    turns: 0,          // 对话轮次
    steps: 0,          // 内核步数
    llmMs: 0,          // 模型耗时总计
    toolMs: 0,         // 行动耗时总计
    ttftMs: 0,         // 首 token 耗时
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    errors: 0,
    recovered: 0,      // 失败后恢复的次数
  }
}

/** 往 stats 里累加一次行动 */
export function addStepStat(stats, { llmMs = 0, toolMs = 0, ok = true, recovered = false } = {}) {
  const s = { ...emptyStats(), ...stats }
  s.steps += 1
  s.llmMs += llmMs
  s.toolMs += toolMs
  if (!ok) s.errors += 1
  if (recovered) s.recovered += 1
  return s
}

/* ══════ CLI 自测 ══════ */
const isMain = String(process.argv[1] || '').endsWith('her-plugin-copy.mjs')
if (isMain) {
  console.log('════ token 估算（抄 dsh-token-meter）════')
  const t = estimateRequestTokens({
    system: '她的系统提示词大概这么长',
    messages: [{ content: '在干嘛呢' }],
    maxOutput: 800,
  })
  console.log(`  一次请求约 ${t} token`)
  console.log(`  1000 次请求约 ${(t * 1000 / 10000).toFixed(1)} 万 token`)

  console.log('\n════ 目标状态机（抄 dsh-goal）════')
  const g1 = { id: 'novel', phase: 'active', roundsStarted: 3, maxGoalRounds: 10 }
  const g2 = { id: 'videos', phase: 'paused', roundsStarted: 0 }
  const g3 = { id: 'sea', phase: 'blocked', blockedReason: blockedReason('insufficient-funds', '没钱') }
  for (const g of [g1, g2, g3]) {
    console.log(`  ${g.id}: selectable=${isSelectable(g)} exhausted=${roundsExhausted(g)} ${g.blockedReason ? '原因=' + g.blockedReason.code : ''}`)
  }

  console.log('\n════ 观测指标（抄 dsh-session-stats）════')
  let st = emptyStats()
  st = addStepStat(st, { llmMs: 12000, toolMs: 45000, ok: true })
  st = addStepStat(st, { llmMs: 8000, toolMs: 0, ok: false })
  console.log(' ', JSON.stringify(st))
}
