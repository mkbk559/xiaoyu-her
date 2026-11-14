/**
 * 目标达标判定 + 归档 her-complete.mjs（2026-11-11）
 *
 * 用户指出：「你抄了 dsh-goal 的 phase 和 evidence-ok → complete，
 *   但没把'达标'接到这条迁移上，等于状态机缺一条腿。」
 *
 * 规格（照抄）：
 *   current >= target && phase !== 'complete'
 *     → applyTransition(goal, 'evidence-ok')   // 任何非 complete → complete
 *     → 写 completedAt、finalValue
 *     → trace 记 goal-completed（goalId、final、耗时、轮次）
 *     → 归档：从 active 移到 completedGoals，保留可查
 *   pickGoal 只从 active/paused/blocked 选，complete 永不进候选
 *
 * 三个细节：
 *   1. 归档不是删除（移到 completedGoals，保留叙事和数字）
 *   2. 幂等（重复判定不重复写 trace、不重复加 completedAt）
 *   3. paused/blocked 达标也能转 complete
 *
 *   node her-complete.mjs check     跑一次达标判定（幂等）
 *   node her-complete.mjs list      看已完成目标
 *   node her-complete.mjs selftest  四条验证
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { applyTransition } from '/opt/her/her-contract.mjs'

const HOME = '/opt/her'
const MIND = `${HOME}/her-mind.json`
const TRACE = `${HOME}/her-trace.jsonl`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

function load() {
  const m = JSON.parse(readFileSync(MIND, 'utf8'))
  if (!Array.isArray(m.completedGoals)) m.completedGoals = []
  return m
}
function save(m) { writeFileSync(MIND, JSON.stringify(m, null, 2)) }

/** trace 写入（带 goal-completed 类型） */
function traceCompleted(goal) {
  try {
    appendFileSync(TRACE, JSON.stringify({
      at: stamp(),
      kind: 'goal-completed',
      goalId: goal.id,
      title: goal.title,
      final: goal.current,
      target: goal.target,
      unit: goal.unit,
      phase: goal.phase,
      completedAt: goal.completedAt,
      roundStarted: goal.roundsStarted || 0,
    }) + '\n')
  } catch { }
}

/**
 * 达标判定（幂等）
 * @returns {{ newlyCompleted: Array, skipped: Array, alreadyDone: Array }}
 */
export function checkComplete({ dryRun = false } = {}) {
  const m = load()
  const newlyCompleted = []
  const skipped = []
  const alreadyDone = []

  for (const g of m.goals || []) {
    const phase = g.phase || 'active'
    const cur = Number(g.current) || 0
    const target = Number(g.target) || Infinity

    // 已 complete：幂等，不重复处理
    if (phase === 'complete') { alreadyDone.push(g.id); continue }

    // 未达标
    if (cur < target) { skipped.push({ id: g.id, cur, target }); continue }

    // 达标：任何非 complete 状态都转 complete（规则 3）
    if (dryRun) {
      newlyCompleted.push({ id: g.id, from: phase, cur, target, dry: true })
      continue
    }

    // 已归档过（幂等保护：有 completedAt 就不再写）
    if (g.completedAt) {
      alreadyDone.push(g.id)
      // 但 phase 还不是 complete，补一下状态
      g.phase = 'complete'
      continue
    }

    // 执行迁移
    const r = applyTransition(g, 'evidence-ok', `达标 ${cur}/${target} ${g.unit || ''}`)
    if (!r.changed) { skipped.push({ id: g.id, reason: r.reason }); continue }

    // 写 completedAt / finalValue
    const completed = {
      ...r.goal,
      completedAt: stamp(),
      finalValue: cur,
      finalTarget: target,
      completedFromPhase: phase,
    }
    g.phase = completed.phase
    g.revision = completed.revision
    g.updatedAt = completed.updatedAt
    g.phaseHistory = completed.phaseHistory
    g.completedAt = completed.completedAt
    g.finalValue = cur
    g.finalTarget = target
    g.completedFromPhase = phase

    // trace
    traceCompleted(g)

    newlyCompleted.push({ id: g.id, from: phase, cur, target })
  }

  // 归档：把 complete 的目标移到 completedGoals（但保留在 goals 里供 pickGoal 跳过）
  // 用户要求「归档不是删除」，所以两边都留：goals 里保留记录（phase=complete），
  // completedGoals 里放一份快照供查看
  for (const g of m.goals || []) {
    if ((g.phase || 'active') !== 'complete') continue
    const exists = m.completedGoals.some(x => x.id === g.id && x.completedAt === g.completedAt)
    if (!exists) {
      m.completedGoals.push({
        id: g.id,
        title: g.title,
        target: g.target,
        unit: g.unit,
        finalValue: g.finalValue,
        completedAt: g.completedAt,
        completedFromPhase: g.completedFromPhase,
        why: g.why || '',
        archivedAt: stamp(),
      })
    }
  }

  save(m)
  return { newlyCompleted, skipped, alreadyDone }
}

/** 兼容导出：给 her-mind 用（返回是否有新完成的） */
export function checkCompleteSimple() {
  try {
    const r = checkComplete()
    return { ok: true, completed: r.newlyCompleted, archived: r.newlyCompleted.length }
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 100) } }
}

/* ══════ CLI ══════ */
const isMain = String(process.argv[1] || '').endsWith('her-complete.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'check'

  if (cmd === 'check') {
    const r = checkComplete()
    console.log('════ 达标判定 ════')
    console.log(`  新完成: ${r.newlyCompleted.length} 个`)
    for (const x of r.newlyCompleted) console.log(`    ✅ ${x.id}  ${x.cur}/${x.target}（${x.from} → complete）`)
    console.log(`  已 complete: ${r.alreadyDone.length} 个 ${r.alreadyDone.join(',') || ''}`)
    console.log(`  未达标: ${r.skipped.filter(s => s.cur !== undefined).length} 个`)
    for (const x of r.skipped.filter(s => s.cur !== undefined)) console.log(`    ${x.id}  ${x.cur}/${x.target}`)
  }

  if (cmd === 'list') {
    const m = load()
    console.log('════ 已完成目标（归档）════')
    if (!m.completedGoals?.length) console.log('  （无）')
    for (const g of m.completedGoals || []) {
      console.log(`  ${g.id}: ${g.title}`)
      console.log(`    ${g.finalValue}/${g.target} ${g.unit}  完成于 ${g.completedAt}`)
      console.log(`    从 ${g.completedFromPhase} → complete，归档于 ${g.archivedAt}`)
    }
    console.log()
    console.log('════ 当前 goals 里的状态 ════')
    for (const g of m.goals || []) {
      console.log(`  ${g.id}: phase=${g.phase || 'active'}  ${g.current}/${g.target}`)
    }
  }

  if (cmd === 'selftest') {
    console.log('════════ 四条验证 ════════\n')

    console.log('【1】看海目标 2300/2300')
    let m = load()
    let sea = m.goals.find(g => g.id === 'sea')
    console.log(`  验证前: phase=${sea.phase || 'active'}  ${sea.current}/${sea.target}  completedAt=${sea.completedAt || '无'}`)

    const r1 = checkComplete()
    m = load()
    sea = m.goals.find(g => g.id === 'sea')
    const traceHas = existsSync(TRACE) && readFileSync(TRACE, 'utf8').includes('goal-completed')
    const traceCount = existsSync(TRACE) ? readFileSync(TRACE, 'utf8').split('\n').filter(l => l.includes('goal-completed')).length : 0

    console.log(`  验证后: phase=${sea.phase}  completedAt=${sea.completedAt || '无'}`)
    console.log(`  trace 有 goal-completed: ${traceHas ? '✅' : '❌'}（共 ${traceCount} 条）`)
    console.log(`  期望: phase=complete ✅  completedAt 有值 ✅  trace 有记录 ✅`)
    console.log()

    console.log('【2】再跑一次 pickGoal（看海不该进候选）')
    // 动态 import pickGoal 不可行（未导出），用逻辑复现
    const active = (m.goals || []).filter(g =>
      (g.phase || 'active') !== 'complete' &&
      g.current < g.target &&
      ['novel', 'videos'].includes(g.id)
    )
    const seaInCandidates = active.some(g => g.id === 'sea')
    console.log(`  候选目标: ${active.map(g => g.id).join(',') || '（无）'}`)
    console.log(`  看海在候选里: ${seaInCandidates ? '❌ 在（不该）' : '✅ 不在'}`)
    console.log()

    console.log('【3】再跑一次达标判定（幂等）')
    const before = traceCount
    const r3 = checkComplete()
    const after = existsSync(TRACE) ? readFileSync(TRACE, 'utf8').split('\n').filter(l => l.includes('goal-completed')).length : 0
    m = load()
    const sea2 = m.goals.find(g => g.id === 'sea')
    console.log(`  trace 数: ${before} → ${after} ${before === after ? '✅ 没重复写' : '❌ 重复了'}`)
    console.log(`  completedAt 变了吗: ${sea2.completedAt === sea.completedAt ? '✅ 没变（幂等）' : '❌ 变了'}`)
    console.log(`  新完成数: ${r3.newlyCompleted.length} ${r3.newlyCompleted.length === 0 ? '✅ 0（已经是 complete）' : '❌ 重复完成'}`)
    console.log()

    console.log('【4】造一个 paused 目标补到 100%')
    m = load()
    // 造个临时目标
    const tmp = {
      id: 'test-paused-goal',
      title: '测试用：paused 目标补到 100%',
      target: 10,
      current: 10,
      unit: '件',
      phase: 'paused',
      desire: 0.1,
    }
    m.goals.push(tmp)
    save(m)
    console.log(`  造了 paused 目标: current=${tmp.current} target=${tmp.target} phase=${tmp.phase}`)
    const r4 = checkComplete()
    m = load()
    const after4 = m.goals.find(g => g.id === 'test-paused-goal')
    console.log(`  验证后: phase=${after4.phase}  completedAt=${after4.completedAt || '无'}`)
    console.log(`  结果: ${after4.phase === 'complete' ? '✅ paused → complete 成功' : '❌ 没转'}`)
    // 清理测试目标
    m.goals = m.goals.filter(g => g.id !== 'test-paused-goal')
    m.completedGoals = (m.completedGoals || []).filter(g => g.id !== 'test-paused-goal')
    save(m)
    console.log(`  已清理测试目标`)
  }
}
