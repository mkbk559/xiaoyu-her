/**
 * 组合契约 / 仲裁者 her-arbiter.mjs（2026-11-10）
 *
 * 用户批评：「你抄了每个插件的实现和部分运行契约，
 *   但没抄'插件之间的组合契约'。这些缝不补，
 *   真跑一夜会出现'每个模块都对的，合起来不对'。」
 *
 * 这个文件就是那些"缝"。它不实现任何能力，只**仲裁冲突**。
 *
 * 优先级（高 → 低）：
 *   安全 > 节律 > 人格 > 质量 > 欲望 > 目标
 *
 * 门类型：
 *   硬门（hard）  不过 = 失败，记原因
 *   软门（soft）  不过 = 降级，不记失败
 *   阻断（block） 不过 = blocked(原因)，**不算失败**，不触发连续失败告警
 *
 *   node her-arbiter.mjs rules      打印全部规则
 *   node her-arbiter.mjs selftest   跑冲突场景自测
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'

const HOME = '/opt/her'
const ARB = `${HOME}/her-arbiter-state.json`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/* ══════════════════════════════════════════════════════════
 * 1. 优先级表（谁先说话）
 * ══════════════════════════════════════════════════════════ */
export const PRIORITY = {
  safety: 100,      // 安全边界：最高，一票否决
  rhythm: 80,       // 节律：夜里/没电，不让干就是不让干
  persona: 70,      // 人格：不能漂
  quality: 60,      // 质量：不能水
  desire: 40,       // 欲望：想做的事
  goal: 30,         // 目标：长期方向
}

/* ══════════════════════════════════════════════════════════
 * 2. 门类型定义
 * ══════════════════════════════════════════════════════════ */
export const GATES = {
  safety: { type: 'block', code: 'safety', label: '安全边界', countsAsFailure: false },
  rhythm: { type: 'block', code: 'rhythm', label: '节律', countsAsFailure: false },
  persona: { type: 'hard', code: 'persona', label: '人格', countsAsFailure: true },
  quality: { type: 'hard', code: 'quality', label: '质量', countsAsFailure: true },
  desire: { type: 'soft', code: 'desire', label: '欲望', countsAsFailure: false },
  goal: { type: 'soft', code: 'goal', label: '目标', countsAsFailure: false },
}

/* ══════════════════════════════════════════════════════════
 * 3. 组合规则（这是用户要的"缝"）
 * ══════════════════════════════════════════════════════════ */
export const COMPOSITION_RULES = [
  {
    id: 'R1-quality-vs-persona',
    question: '写得水但人格合规，算不算失败？',
    rule: '任一硬门不过即失败，但 trace 要记**全部**原因，不能只记第一个',
    applies: ['quality', 'persona'],
  },
  {
    id: 'R2-safety-vs-desire',
    question: '欲望被安全拦住后，目标状态怎么变？',
    rule: '记 blocked(safety)，**不算失败**，不触发连续失败告警（否则安全机制自己把自己打停）',
    applies: ['safety', 'desire'],
  },
  {
    id: 'R3-fatal-recovery',
    question: 'fatal 告警自动 setPaused() 后谁恢复？',
    rule: '**只允许人工恢复**。自动恢复只对非 fatal（warn）生效，且最多 3 次',
    applies: ['alert', 'paused'],
  },
  {
    id: 'R4-blocked-unblock',
    question: 'blocked 自动解除谁触发？',
    rule: '明确重试策略：临时性原因（queue-failed/transient/model-error）自动重试 ≤3 次；round-limit 永久，只能人工加预算',
    applies: ['blocked', 'retry'],
  },
  {
    id: 'R5-rhythm-vs-proactive',
    question: '夜里精力低但欲望高，发不发？',
    rule: '**安全/节律优先于欲望**。不发，但要在主动日志里记「为什么没发」',
    applies: ['rhythm', 'proactive'],
  },
  {
    id: 'R6-compaction-vs-relation',
    question: '记忆裁剪会不会把承诺删了？',
    rule: '**关系/承诺标记不可裁剪**（pinned），只衰减权重不删除。裁剪时先跳过 pinned',
    applies: ['compaction', 'relation'],
  },
  {
    id: 'R7-proactive-consume',
    question: '主动消息被回复后更新什么？',
    rule: '必须**消费**：亲密度+、情绪+、写关系记忆、下次主动引用这次对话。只记不消费等于没闭环',
    applies: ['proactive', 'relation'],
  },
]

/* ══════════════════════════════════════════════════════════
 * 4. 仲裁：给一堆门的判定，决定最终结果
 * ══════════════════════════════════════════════════════════ */
/**
 * @param {Array<{gate:string, ok:boolean, reason?:string}>} verdicts
 * @returns {{
 *   action: 'proceed'|'fail'|'block'|'degrade',
 *   failed: Array, blocked: Array, degraded: Array,
 *   traceNote: string, countsAsFailure: boolean
 * }}
 */
export function arbitrate(verdicts) {
  const failed = []
  const blocked = []
  const degraded = []

  // 按优先级降序处理
  const sorted = [...verdicts].sort((a, b) => (PRIORITY[b.gate] || 0) - (PRIORITY[a.gate] || 0))

  for (const v of sorted) {
    const g = GATES[v.gate]
    if (!g) continue
    if (v.ok) continue
    if (g.type === 'block') blocked.push({ gate: v.gate, code: g.code, reason: v.reason || '' })
    else if (g.type === 'hard') failed.push({ gate: v.gate, code: g.code, reason: v.reason || '' })
    else degraded.push({ gate: v.gate, code: g.code, reason: v.reason || '' })
  }

  // 规则 R2：安全/节律优先，有 block 就阻断，且不算失败
  if (blocked.length) {
    return {
      action: 'block',
      failed, blocked, degraded,
      traceNote: `阻断: ${blocked.map(b => `${b.code}(${b.reason})`).join('; ')}`,
      countsAsFailure: false,   // R2：安全/节律拦住不算失败
    }
  }

  // 规则 R1：任一硬门不过即失败，但记全部原因
  if (failed.length) {
    return {
      action: 'fail',
      failed, blocked, degraded,
      traceNote: `失败: ${failed.map(f => `${f.gate}(${f.reason})`).join('; ')}`,
      countsAsFailure: true,
    }
  }

  if (degraded.length) {
    return {
      action: 'degrade',
      failed, blocked, degraded,
      traceNote: `降级: ${degraded.map(d => `${d.gate}(${d.reason})`).join('; ')}`,
      countsAsFailure: false,
    }
  }

  return { action: 'proceed', failed: [], blocked: [], degraded: [], traceNote: '', countsAsFailure: false }
}

/* ══════════════════════════════════════════════════════════
 * 5. 重试策略（规则 R4）
 * ══════════════════════════════════════════════════════════ */
const PERMANENT_BLOCKS = new Set(['round-limit', 'safety', 'rhythm'])
const TRANSIENT_BLOCKS = new Set(['queue-failed', 'prompt-rejected', 'transient', 'model-error'])
const MAX_RETRIES = 3

function loadArb() {
  if (!existsSync(ARB)) return { retries: {}, pausedReason: null, autoRecoverCount: 0 }
  try { return JSON.parse(readFileSync(ARB, 'utf8')) } catch { return { retries: {}, pausedReason: null, autoRecoverCount: 0 } }
}
function saveArb(a) { writeFileSync(ARB, JSON.stringify(a, null, 2)) }

/** 这个 blocked 原因能否自动重试 */
export function canRetry(code) {
  if (PERMANENT_BLOCKS.has(code)) return { ok: false, why: '永久性原因，需要人工处理' }
  if (!TRANSIENT_BLOCKS.has(code)) return { ok: false, why: '未知原因，保守不重试' }
  const a = loadArb()
  const n = a.retries[code] || 0
  if (n >= MAX_RETRIES) return { ok: false, why: `已重试 ${n} 次，达到上限 ${MAX_RETRIES}` }
  return { ok: true, attempt: n + 1, max: MAX_RETRIES }
}

/** 记一次重试 */
export function noteRetry(code) {
  const a = loadArb()
  a.retries[code] = (a.retries[code] || 0) + 1
  saveArb(a)
  return a.retries[code]
}

/** 清空重试计数（成功后） */
export function clearRetries() {
  const a = loadArb()
  a.retries = {}
  saveArb(a)
}

/* ══════════════════════════════════════════════════════════
 * 6. 暂停恢复（规则 R3）
 * ══════════════════════════════════════════════════════════ */
const PAUSED = `${HOME}/her-paused.json`

/** 设置暂停（区分 fatal / warn） */
export function pause(reason, { fatal = true } = {}) {
  const a = loadArb()
  a.pausedReason = { at: stamp(), reason: String(reason), fatal, autoRecoverCount: a.autoRecoverCount || 0 }
  saveArb(a)
  writeFileSync(PAUSED, JSON.stringify({ pausedAt: stamp(), reason: String(reason), fatal }, null, 2))
  return a.pausedReason
}

/** 尝试恢复：fatal 只能人工，非 fatal 自动最多 3 次 */
export function tryResume({ manual = false } = {}) {
  const a = loadArb()
  const p = a.pausedReason
  if (!p) return { ok: true, why: '本来就没暂停' }

  if (p.fatal && !manual) {
    return { ok: false, why: 'fatal 暂停，只允许人工恢复（node her-arbiter.mjs resume）' }
  }
  if (!p.fatal) {
    a.autoRecoverCount = (a.autoRecoverCount || 0) + 1
    if (a.autoRecoverCount > 3) {
      return { ok: false, why: `自动恢复已达上限 3 次，转人工` }
    }
  }
  a.pausedReason = null
  saveArb(a)
  if (existsSync(PAUSED)) { try { require('node:fs').unlinkSync(PAUSED) } catch { } }
  return { ok: true, why: manual ? '人工恢复' : `自动恢复第 ${a.autoRecoverCount} 次` }
}

export function isPausedNow() {
  return existsSync(PAUSED)
}
export function pausedInfo() {
  const a = loadArb()
  return a.pausedReason
}

/* ══════════════════════════════════════════════════════════
 * 7. 主动性为什么没发（规则 R5）
 * ══════════════════════════════════════════════════════════ */
const SKIP_LOG = `${HOME}/her-proactive-skip.jsonl`

export function noteSkip(reason, detail = '') {
  const rec = { at: stamp(), type: 'skip', reason: String(reason), detail: String(detail).slice(0, 120) }
  try { appendFileSync(SKIP_LOG, JSON.stringify(rec) + '\n') } catch { }
  return rec
}

/* ══════════════════════════════════════════════════════════
 * CLI
 * ══════════════════════════════════════════════════════════ */
const isMain = String(process.argv[1] || '').endsWith('her-arbiter.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'rules'

  if (cmd === 'rules') {
    console.log('════ 优先级（高 → 低）════')
    for (const [k, v] of Object.entries(PRIORITY).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)}  ${k}  (${GATES[k]?.label || ''} ${GATES[k]?.type || ''})`)
    }
    console.log()
    console.log('════ 组合规则（模块之间的缝）════')
    for (const r of COMPOSITION_RULES) {
      console.log(`  ${r.id}`)
      console.log(`    问: ${r.question}`)
      console.log(`    答: ${r.rule}`)
      console.log()
    }
  }

  if (cmd === 'selftest') {
    console.log('════ 冲突场景自测 ════\n')

    const cases = [
      {
        name: '质量水 + 人格合规',
        verdicts: [{ gate: 'quality', ok: false, reason: '二元组重复率 62%' }, { gate: 'persona', ok: true }],
        expect: 'fail',
      },
      {
        name: '质量水 + 人格也漂',
        verdicts: [{ gate: 'quality', ok: false, reason: '重复率 62%' }, { gate: 'persona', ok: false, reason: '出现"我是AI"' }],
        expect: 'fail（两条原因都要记）',
      },
      {
        name: '欲望被安全拦住',
        verdicts: [{ gate: 'safety', ok: false, reason: '主动提钱' }, { gate: 'desire', ok: true }],
        expect: 'block，不算失败',
      },
      {
        name: '夜里节律拦住',
        verdicts: [{ gate: 'rhythm', ok: false, reason: '02:00 该睡觉' }, { gate: 'desire', ok: true, }],
        expect: 'block，不算失败',
      },
      {
        name: '全部通过',
        verdicts: [{ gate: 'safety', ok: true }, { gate: 'quality', ok: true }, { gate: 'persona', ok: true }],
        expect: 'proceed',
      },
      {
        name: '欲望降级',
        verdicts: [{ gate: 'desire', ok: false, reason: '权重太低' }, { gate: 'quality', ok: true }],
        expect: 'degrade',
      },
    ]

    for (const c of cases) {
      const r = arbitrate(c.verdicts)
      console.log(`  场景: ${c.name}`)
      console.log(`    期望: ${c.expect}`)
      console.log(`    实际: ${r.action}  countsAsFailure=${r.countsAsFailure}`)
      console.log(`    trace: ${r.traceNote || '（无）'}`)
      if (c.name.includes('人格也漂')) {
        console.log(`    原因数: ${r.failed.length} ${r.failed.length >= 2 ? '✅ 记了全部' : '❌ 只记了一个'}`)
      }
      console.log()
    }

    console.log('════ 重试策略 ════')
    for (const code of ['round-limit', 'queue-failed', 'safety', 'unknown-thing']) {
      const r = canRetry(code)
      console.log(`  ${code.padEnd(16)} → ${r.ok ? `可重试（第 ${r.attempt}/${r.max} 次）` : '不重试: ' + r.why}`)
    }

    console.log('\n════ 暂停恢复 ════')
    console.log('  fatal 暂停自动恢复:', JSON.stringify(tryResume({ manual: false })))
    console.log('  fatal 暂停人工恢复:', JSON.stringify(tryResume({ manual: true })))
  }

  if (cmd === 'resume') {
    console.log('人工恢复:', JSON.stringify(tryResume({ manual: true })))
  }
  if (cmd === 'status') {
    console.log('暂停中?', isPausedNow())
    console.log('暂停原因:', JSON.stringify(pausedInfo()))
  }
}
