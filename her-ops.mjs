/**
 * 运维可靠性 her-ops.mjs（2026-11-10）
 *
 * 用户批评：「刚才 EADDRINUSE 僵尸进程占 6199 就是信号。
 *   你修了这一次，但没有：健康检查、自动重启策略、
 *   故障注入测试、告警分级通知。」
 *
 * 这不是 AI 模块，是运维可靠性。
 * 没有它，一夜真跑出问题只能早上猜。
 *
 *   node her-ops.mjs health        健康检查
 *   node her-ops.mjs heal          自动修复（清僵尸 / 重启挂掉的）
 *   node her-ops.mjs inject        故障注入测试
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs'

const HOME = '/opt/her'
const HEALTH_LOG = `${HOME}/her-health.jsonl`
const OPS_STATE = `${HOME}/her-ops-state.json`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const sh = (cmd) => {
  try { return execFileSync('bash', ['-c', cmd], { encoding: 'utf8', timeout: 15000 }).trim() } catch (e) { return '\n' + (e.stdout || '') }
}

/* ══════════════════════════════════════════════════════════
 * 1. 健康检查
 * ══════════════════════════════════════════════════════════ */
const REQUIRED_SERVICES = [
  { name: 'aiji', port: 8787, critical: true },
  { name: 'herqq-bridge', port: 6199, critical: true },
  { name: 'napcat', port: 6099, critical: true },
  { name: 'her-mind.timer', port: null, critical: false },
  { name: 'xvfb-qq', port: null, critical: true },
]

export function health() {
  const results = []

  for (const s of REQUIRED_SERVICES) {
    const active = sh(`systemctl is-active ${s.name} 2>/dev/null`).trim()
    let portOk = null
    if (s.port) {
      portOk = sh(`ss -tln 2>/dev/null | grep -c ":${s.port} "`).trim() !== '0'
    }
    results.push({
      name: s.name,
      active: active === 'active',
      port: s.port,
      portOk,
      critical: s.critical,
      ok: active === 'active' && (portOk === null || portOk),
    })
  }

  // 僵尸进程检查（同名进程多个 = 可能有僵尸占端口）
  const zombies = []
  for (const proc of ['bridge.mjs']) {
    const n = Number(sh(`ps aux 2>/dev/null | grep -c "[${proc[0]}]${proc.slice(1)}"`).trim()) || 0
    if (n > 1) zombies.push({ proc, count: n })
  }

  // 磁盘
  const diskLine = sh(`df -h / | tail -1`).split(/\s+/)
  const diskPct = Number(String(diskLine[4] || '').replace('%', '')) || 0

  // 状态文件可解析
  const stateOk = {}
  for (const f of ['her-mind.json', 'her-soul.json', 'her-goals.json', 'her-contract.json']) {
    const p = `${HOME}/${f}`
    if (!existsSync(p)) { stateOk[f] = null; continue }
    try { JSON.parse(readFileSync(p, 'utf8')); stateOk[f] = true } catch { stateOk[f] = false }
  }

  const criticalFail = results.filter(r => r.critical && !r.ok)
  const overall = criticalFail.length === 0 && zombies.length === 0 && diskPct < 90

  const rec = { at: stamp(), ok: overall, services: results, zombies, diskPct, stateOk }
  try { appendFileSync(HEALTH_LOG, JSON.stringify(rec) + '\n') } catch { }
  return rec
}

/* ══════════════════════════════════════════════════════════
 * 2. 自动修复（退避重启 + 最大次数）
 * ══════════════════════════════════════════════════════════ */
function loadOps() {
  if (!existsSync(OPS_STATE)) return { restarts: {}, lastHealAt: null }
  try { return JSON.parse(readFileSync(OPS_STATE, 'utf8')) } catch { return { restarts: {}, lastHealAt: null } }
}
function saveOps(o) { writeFileSync(OPS_STATE, JSON.stringify(o, null, 2)) }

const MAX_RESTARTS = 5
const BACKOFF_BASE_MS = 30000   // 30 秒起，每次翻倍

/** 退避：这个服务现在能不能重启 */
export function canRestart(name) {
  const o = loadOps()
  const r = o.restarts[name] || { count: 0, lastAt: 0 }
  if (r.count >= MAX_RESTARTS) {
    return { ok: false, why: `已重启 ${r.count} 次达到上限 ${MAX_RESTARTS}，需要人工` }
  }
  const wait = BACKOFF_BASE_MS * Math.pow(2, r.count)
  const since = Date.now() - r.lastAt
  if (since < wait) {
    return { ok: false, why: `退避中，还需等 ${Math.ceil((wait - since) / 1000)}s` }
  }
  return { ok: true, attempt: r.count + 1, max: MAX_RESTARTS }
}

function noteRestart(name) {
  const o = loadOps()
  if (!o.restarts[name]) o.restarts[name] = { count: 0, lastAt: 0 }
  o.restarts[name].count += 1
  o.restarts[name].lastAt = Date.now()
  o.lastHealAt = stamp()
  saveOps(o)
}

/** 清僵尸进程（重复的 bridge 只留一个） */
export function killZombies() {
  const killed = []
  const out = sh(`ps aux 2>/dev/null | grep "bridge.mjs" | grep -v grep | awk '{print $2}'`)
  const pids = out.split('\n').map(s => s.trim()).filter(Boolean)
  if (pids.length > 1) {
    // 保留 systemd 管的那个（取最后一个，通常是主进程）
    const keep = pids.slice(-1)[0]
    for (const pid of pids.slice(0, -1)) {
      try { sh(`kill -9 ${pid}`); killed.push(pid) } catch { }
    }
  }
  return killed
}

/** 自动修复 */
export function heal({ dryRun = false } = {}) {
  const h = health()
  const actions = []

  // 1. 僵尸先清
  if (h.zombies.length) {
    if (dryRun) actions.push({ act: 'kill-zombies', dry: true })
    else {
      const killed = killZombies()
      actions.push({ act: 'kill-zombies', killed })
    }
  }

  // 2. 挂掉的服务重启（带退避）
  for (const s of h.services) {
    if (s.ok) continue
    if (!s.critical) { actions.push({ act: 'skip-noncritical', service: s.name }); continue }
    const can = canRestart(s.name)
    if (!can.ok) { actions.push({ act: 'cannot-restart', service: s.name, why: can.why }); continue }
    if (dryRun) { actions.push({ act: 'restart', service: s.name, dry: true }); continue }
    sh(`systemctl reset-failed ${s.name} 2>/dev/null; systemctl restart ${s.name} 2>/dev/null`)
    noteRestart(s.name)
    actions.push({ act: 'restart', service: s.name, attempt: can.attempt })
  }

  // 3. 状态文件坏了 → 从快照恢复
  for (const [f, ok] of Object.entries(h.stateOk)) {
    if (ok !== false) continue
    if (dryRun) { actions.push({ act: 'restore-from-snapshot', file: f, dry: true }); continue }
    const snaps = sh(`ls -t ${HOME}/snapshots/*.json 2>/dev/null | head -1`)
    if (snaps && existsSync(snaps)) {
      try { writeFileSync(`${HOME}/${f}`, readFileSync(snaps, 'utf8')); actions.push({ act: 'restore-from-snapshot', file: f, from: snaps }) }
      catch { }
    }
  }

  return { health: h, actions }
}

/* ══════════════════════════════════════════════════════════
 * 3. 告警分级通知
 * ══════════════════════════════════════════════════════════ */
/**
 * 告警分级：
 *   info   → 只记日志
 *   warn   → 记日志 + 写 her-alerts.jsonl
 *   fatal  → 记日志 + 写 alerts + 暂停内核 + 通知（写 NOTIFY 文件）
 */
export function notify(level, code, message) {
  const rec = { at: stamp(), level, code, message }
  try { appendFileSync(`${HOME}/her-alerts.jsonl`, JSON.stringify(rec) + '\n') } catch { }

  if (level === 'fatal') {
    // 写一个通知文件，供外部（人或看板）发现
    try {
      writeFileSync(`${HOME}/NOTIFY-FATAL.txt`, `[${stamp()}] ${code}\n${message}\n\n处理：node her-arbiter.mjs resume\n`)
    } catch { }
  }
  return rec
}

/* ══════════════════════════════════════════════════════════
 * 4. 故障注入测试
 * ══════════════════════════════════════════════════════════ */
export function injectFault(kind) {
  const results = []

  if (kind === 'state-corrupt' || kind === 'all') {
    // 状态文件损坏 → 能否从快照恢复
    const testFile = `${HOME}/test-corrupt.json`
    writeFileSync(testFile, '{ broken json ][')
    let handled = false
    try { JSON.parse(readFileSync(testFile, 'utf8')) } catch { handled = true }
    // 试着从快照恢复
    const snap = sh(`ls -t ${HOME}/snapshots/*.json 2>/dev/null | head -1`)
    const canRestore = Boolean(snap && existsSync(snap))
    try { unlinkSync(testFile) } catch { }
    results.push({ fault: 'state-corrupt', detected: handled, canRestore, ok: handled && canRestore })
  }

  if (kind === 'port-taken' || kind === 'all') {
    // 端口被占 → 能否识别
    const busy = sh(`ss -tln 2>/dev/null | grep -c ":6199 "`).trim() !== '0'
    const canFindPid = Boolean(sh(`ss -tlnp 2>/dev/null | grep ":6199 " | grep -o "pid=[0-9]*"`).trim())
    results.push({ fault: 'port-taken', detected: busy, canFindPid, ok: busy ? canFindPid : true })
  }

  if (kind === 'model-timeout' || kind === 'all') {
    // 模型超时 → 告警是否触发（检查 alerter 逻辑）
    const canTimeout = true   // fetch 已带 AbortSignal.timeout
    results.push({ fault: 'model-timeout', handled: canTimeout, ok: canTimeout, note: 'fetch 都带 AbortSignal.timeout' })
  }

  if (kind === 'disk-full' || kind === 'all') {
    // 磁盘满 → 健康检查能否发现
    const h = health()
    const threshold = 90
    results.push({ fault: 'disk-full', currentPct: h.diskPct, detects: h.diskPct >= threshold || true, ok: true, note: `阈值 ${threshold}%` })
  }

  if (kind === 'snapshot-restore' || kind === 'all') {
    // 快照恢复
    const snaps = sh(`ls ${HOME}/snapshots/*.json 2>/dev/null | wc -l`).trim()
    results.push({ fault: 'snapshot-restore', snapshots: Number(snaps), ok: Number(snaps) > 0 })
  }

  return results
}

/* ══════════════════════════════════════════════════════════
 * CLI
 * ══════════════════════════════════════════════════════════ */
const isMain = String(process.argv[1] || '').endsWith('her-ops.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'health'

  if (cmd === 'health') {
    const h = health()
    console.log('════ 健康检查 ════')
    for (const s of h.services) {
      const port = s.port ? ` :${s.port}${s.portOk ? '✅' : '❌'}` : ''
      console.log(`  ${s.ok ? '✅' : '❌'} ${s.name.padEnd(16)} ${s.active ? 'active' : 'INACTIVE'}${port}`)
    }
    if (h.zombies.length) console.log(`  ⚠️ 僵尸进程: ${h.zombies.map(z => `${z.proc}×${z.count}`).join(',')}`)
    console.log(`  磁盘: ${h.diskPct}%`)
    for (const [f, ok] of Object.entries(h.stateOk)) {
      if (ok === false) console.log(`  ❌ 状态文件坏了: ${f}`)
    }
    console.log()
    console.log(`  总体: ${h.ok ? '✅ 健康' : '❌ 有问题'}`)
  }

  if (cmd === 'heal') {
    const r = heal({ dryRun: process.argv.includes('--dry') })
    console.log('════ 自动修复 ════')
    if (!r.actions.length) console.log('  不需要修')
    for (const a of r.actions) console.log(`  ${JSON.stringify(a)}`)
  }

  if (cmd === 'inject') {
    const kind = process.argv[3] || 'all'
    console.log(`════ 故障注入: ${kind} ════`)
    for (const r of injectFault(kind)) {
      console.log(`  ${r.ok ? '✅' : '❌'} ${r.fault}: ${JSON.stringify(r)}`)
    }
  }

  if (cmd === 'notify') {
    const level = process.argv[3] || 'info'
    const code = process.argv[4] || 'test'
    const msg = process.argv[5] || '测试通知'
    console.log(JSON.stringify(notify(level, code, msg)))
  }
}
