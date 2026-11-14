/**
 * 静态 bug 扫描（2026-11-11）
 * 只读，不碰生产状态。
 */
import { readFileSync, existsSync } from 'node:fs'

const FILES = [
  '/opt/her/her-mind.mjs',
  '/opt/her/her-contract.mjs',
  '/opt/her/her-arbiter.mjs',
  '/opt/her/her-ops.mjs',
  '/opt/her/her-soul.mjs',
  '/opt/her/her-world.mjs',
  '/opt/her/her-consume.mjs',
  '/opt/her/her-complete.mjs',
  '/opt/her/her-verify.mjs',
  '/opt/her/herqq/../herqq/bridge.mjs',
  '/opt/her/daily-toon.mjs',
  '/opt/her/write-novel.mjs',
]

const findings = []

for (const f of FILES) {
  const path = f.includes('herqq') ? '/opt/herqq/bridge.mjs' : f
  if (!existsSync(path)) { findings.push({ file: path, level: 'error', msg: '文件不存在' }); continue }
  const c = readFileSync(path, 'utf8')
  const lines = c.split('\n')

  // 1. 未捕获的 async 调用（可能 unhandled rejection）
  lines.forEach((l, i) => {
    if (/^\s*(setInterval|setTimeout)\(.*async/.test(l) && !l.includes('.catch')) {
      findings.push({ file: path, line: i + 1, level: 'warn', msg: '定时器里的 async 没 .catch' })
    }
  })

  // 2. 裸 await 在非 try 里（可能崩）
  // 跳过

  // 3. 引用未定义的变量（简单启发式：检查常见遗漏）
  const defined = new Set()
  lines.forEach(l => {
    const m = l.match(/(?:const|let|var|function|import)\s+([A-Za-z_$][\w$]*)/g)
    if (m) m.forEach(x => defined.add(x.replace(/^(const|let|var|function|import)\s+/, '')))
    const im = l.match(/import\s*\{([^}]*)\}/)
    if (im) im[1].split(',').forEach(x => { const n = x.trim().split(/\s+as\s+/).pop(); if (n) defined.add(n) })
  })

  // 4. 检查 sendRaw 这类历史遗留
  if (c.includes('sendRaw') && !c.includes('function sendRaw') && !c.includes('const sendRaw')) {
    findings.push({ file: path, level: 'error', msg: '用了未定义的 sendRaw' })
  }

  // 5. checkPersona 调用是否带 forContent（小说场景）
  if (path.includes('her-mind') && c.includes('checkPersona(novelText)')) {
    findings.push({ file: path, level: 'error', msg: '小说检查没传 forContent（会被长度误拦）' })
  }

  // 6. existsSync 前没检查路径
  // 跳过

  // 7. 硬编码路径检查
  const hardcoded = lines.filter(l => /\/opt\/her\/(her-mind|her-soul|her-goals)\.json/.test(l) && !l.includes('${') && !l.includes('`'))
  if (hardcoded.length > 3) {
    findings.push({ file: path, level: 'info', msg: `硬编码状态路径 ${hardcoded.length} 处` })
  }
}

// 8. 检查状态文件一致性
const MIND = '/opt/her/her-mind.json'
const GOALS = '/opt/her/her-goals.json'
if (existsSync(MIND)) {
  const m = JSON.parse(readFileSync(MIND, 'utf8'))
  // goals 与 completedGoals 一致性
  for (const g of m.completedGoals || []) {
    const active = (m.goals || []).find(x => x.id === g.id)
    if (!active) findings.push({ file: MIND, level: 'error', msg: `归档了 ${g.id} 但 goals 里没有` })
    else if (active.phase !== 'complete') findings.push({ file: MIND, level: 'error', msg: `归档了 ${g.id} 但 phase=${active.phase}` })
  }
  // today.did 里有没有 dry 残留
  const dryInDid = (m.today?.did || []).filter(d => d.note === 'dry-run')
  if (dryInDid.length) findings.push({ file: MIND, level: 'error', msg: `today.did 有 ${dryInDid.length} 条 dry-run 残留` })
  // emotion 数值范围
  const em = m.emotion || {}
  if (em.energy < 0 || em.energy > 100) findings.push({ file: MIND, level: 'warn', msg: `emotion.energy=${em.energy} 越界` })
  if (em.stress < 0 || em.stress > 100) findings.push({ file: MIND, level: 'warn', msg: `emotion.stress=${em.stress} 越界` })
}

// 9. trace 里有没有 dry-run 生产残留
const TRACE = '/opt/her/her-trace.jsonl'
if (existsSync(TRACE)) {
  const lines = readFileSync(TRACE, 'utf8').split('\n').filter(Boolean)
  const dry = lines.filter(l => l.includes('"dry":true') || l.includes('dry-run'))
  if (dry.length) findings.push({ file: TRACE, level: 'warn', msg: `生产 trace 有 ${dry.length} 条 dry 残留` })
}

// 10. 暂停/告警残留
if (existsSync('/opt/her/her-paused.json')) findings.push({ level: 'error', msg: '有暂停残留' })
if (existsSync('/opt/her/NOTIFY-FATAL.txt')) findings.push({ level: 'error', msg: '有 fatal 残留' })

// 输出
console.log('════════ 静态扫描结果 ════════\n')
if (!findings.length) {
  console.log('  ✅ 没发现问题')
} else {
  const byLevel = { error: [], warn: [], info: [] }
  for (const f of findings) (byLevel[f.level] || byLevel.info).push(f)
  for (const [lv, list] of Object.entries(byLevel)) {
    if (!list.length) continue
    const icon = lv === 'error' ? '❌' : lv === 'warn' ? '⚠️' : 'ℹ️'
    console.log(`${icon} ${lv} (${list.length})`)
    for (const f of list) {
      const loc = f.line ? `:${f.line}` : ''
      console.log(`    ${f.file || ''}${loc}  ${f.msg}`)
    }
    console.log()
  }
}
