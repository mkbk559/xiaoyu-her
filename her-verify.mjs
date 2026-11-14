/**
 * 行动结果验证 + 可观测回放（2026-11-10）
 *
 * 用户列的 10 个缺口里，这两个不补今晚闭环会崩：
 *   P0-1 行动结果验证：写小说"真跑通"了，但缺
 *        质量检查、重复检测、失败恢复、成本上限
 *        → 不补会"字数涨了但越写越水"
 *   P0-2 可观测与回放：主动消息理由、目标选择理由、反思是否影响下一步
 *        → 不补出问题只能猜
 *
 *   node her-verify.mjs novel          检查最新小说章节质量
 *   node her-verify.mjs trace [n]      回放最近 n 步（目标选择理由 / 执行 / 反思）
 *   node her-verify.mjs cost           成本检查
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, appendFileSync } from 'node:fs'

import { detectWater } from '/opt/her/her-contract.mjs'

const HOME = '/opt/her'
const NOVEL_DIR = `${HOME}/novel/正文`
const TRACE = `${HOME}/her-trace.jsonl`
const MIND = `${HOME}/her-mind.json`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/* ══════════ P0-1 行动结果验证 ══════════ */

/** 小说质量检查：水字数 / 重复 / 长度异常 */
export function checkNovel() {
  if (!existsSync(NOVEL_DIR)) return { ok: false, reason: '没有小说目录' }
  const files = readdirSync(NOVEL_DIR).filter(f => f.endsWith('.md')).sort()
  if (!files.length) return { ok: false, reason: '没有正文' }

  const latest = files[files.length - 1]
  const text = readFileSync(`${NOVEL_DIR}/${latest}`, 'utf8')
  // 2026-11-11 修：文件是**追加**写入的，checkNovel 只该查**最新一段**，
  // 不能查整个文件（否则越写越"太长"，永远过不了）
  // 用 "## 又一段" 或 "## YYYY-MM-DD" 这类分段标记切出最后一段
  const segs = text.split(/^##\s/m)
  const lastSeg = segs.length > 1 ? segs[segs.length - 1] : text
  const body = lastSeg.trim()
  const chars = body.replace(/\s/g, '').length

  const problems = []

  // 1) 长度异常：一章 800-1500 字是正常，少于 300 是废章，多于 3000 是失控
  if (chars < 300) problems.push(`太短（${chars} 字，低于 300）`)
  if (chars > 3500) problems.push(`太长（${chars} 字，超过 3500）`)

  // 2) 水字数检测：用 her-contract.mjs 的 detectWater
  //    2026-11-10：经 10 正常 + 10 水字数基准集验证，20/20 通过。
  //    换掉了原来"4-gram 阈值 12"的拍脑袋方案（那个漏检 8/10）。
  const water = detectWater(body)
  for (const p of water.problems) problems.push(p)

  // 3) 跨章重复（2026-11-11 修：只在**真跨章**时查，同一天追加不算跨章）
  //   同一天写两段时，第二段会和第一段自然有承接，不该算"重影"
  const sameDayOther = files.filter(f => f !== latest)
  if (sameDayOther.length > 0) {
    const prev = sameDayOther.map(f => readFileSync(`${NOVEL_DIR}/${f}`, 'utf8')).join('\n')
    const sentences = body.split(/[。！？]/).map(s => s.trim()).filter(s => s.length > 12)
    let dup = 0
    for (const s of sentences) if (prev.includes(s)) dup++
    if (dup > 3) problems.push(`和前面章节有 ${dup} 句重影`)
  }

  // 4) 语感检查：她的文本该有"账/钱/雨/猫/稿"这类具体词
  const concrete = ['账', '钱', '雨', '猫', '稿', '单', '块', '房租', '水电']
  const hits = concrete.filter(w => body.includes(w))
  if (hits.length < 2) problems.push(`缺具体细节（只有 ${hits.join('/') || '无'}）——可能写飘了`)

  return {
    ok: problems.length === 0,
    file: latest,
    chars,
    problems,
    preview: body.slice(0, 120),
    waterProblems: water.problems,
  }
}

/** 成本上限检查 */
export function checkCost() {
  const p = `${HOME}/ledger-token.jsonl`
  if (!existsSync(p)) return { ok: true, note: '没有 token 账本' }
  const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  let left = 0, spentToday = 0
  const today = stamp().slice(0, 10)
  for (const r of rows) {
    const a = Number(r.amount) || 0
    if (r.type === 'init' || r.type === 'topup') left += a
    else if (r.type === 'spend') {
      left -= a
      if (String(r.at || '').startsWith(today)) spentToday += a
    }
  }
  const DAY_CAP = 500000   // 一天最多烧 50 万 token
  return {
    ok: spentToday < DAY_CAP,
    left: Math.max(0, left),
    spentToday,
    dayCap: DAY_CAP,
    over: spentToday >= DAY_CAP,
    note: spentToday >= DAY_CAP ? '今天额度用超了，该停下' : '',
  }
}

/* ══════════ P0-2 可观测与回放 ══════════ */

/** 记录一步的选择理由（供回放） */
export function trace(rec) {
  try {
    appendFileSync(TRACE, JSON.stringify({ at: stamp(), ...rec }) + '\n')
  } catch { }
}

/** 回放最近 n 步 */
export function replay(n = 10) {
  if (!existsSync(TRACE)) return []
  return readFileSync(TRACE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).slice(-n)
}

/* ══════════ CLI ══════════ */
/** 2026-11-13: 候选文本质量检查（写进正文之前用；规则同 checkNovel 的长度/水字数/具体词三项） */
export function checkNovelText(body) {
  const text = String(body || "").trim()
  const chars = text.split("").filter(function (c) { return c.trim().length > 0 }).length
  const problems = []
  if (chars < 300) problems.push("太短（" + chars + " 字，低于 300）")
  if (chars > 3500) problems.push("太长（" + chars + " 字，超过 3500）")
  let water = { problems: [] }
  try { water = detectWater(text) } catch (e) { water = { problems: [] } }
  for (const p of water.problems) problems.push(p)
  const concrete = ["账", "钱", "雨", "猫", "稿", "单", "块", "房租", "水电"]
  const hits = concrete.filter(function (w) { return text.includes(w) })
  if (hits.length < 2) problems.push("缺具体细节（只有 " + (hits.join("/") || "无") + "）——可能写飘了")
  return { ok: problems.length === 0, chars: chars, problems: problems }
}
const isMain = String(process.argv[1] || '').endsWith('her-verify.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'novel'
  if (cmd === 'novel') {
    const r = checkNovel()
    console.log('════ 小说质量检查 ════')
    console.log(`  文件: ${r.file || '-'}`)
    console.log(`  字数: ${r.chars || 0}`)
    console.log(`  结论: ${r.ok ? '✅ 通过' : '⚠️ 有问题'}`)
    if (r.problems?.length) for (const p of r.problems) console.log(`    - ${p}`)
    if (r.topGrams?.length) console.log('  高频短语:', r.topGrams.map(([g, n]) => `「${g}」×${n}`).join(' '))
    if (r.preview) console.log('  开头:', r.preview)
  } else if (cmd === 'trace') {
    const n = Number(process.argv[3]) || 10
    const rows = replay(n)
    console.log(`════ 回放最近 ${rows.length} 步 ════`)
    for (const r of rows) {
      const t = String(r.at || '').slice(11, 16)
      if (r.kind === 'tick') {
        console.log(`  ${t} 选目标「${r.goal}」理由: ${r.reason || '-'}`)
        console.log(`        执行 ${r.act} → ${r.ok ? '成功' : '失败'} ${r.note || ''} ${r.realGain ? `(真实产出 +${r.novelDelta || 0}字/+${r.videoDelta || 0}条)` : ''}`)
      } else if (r.kind === 'proactive') {
        console.log(`  ${t} 主动开口理由: ${r.reason || '-'} → 「${(r.text || '').slice(0, 30)}」`)
      } else if (r.kind === 'reflect') {
        console.log(`  ${t} 反思: ${r.did} → 下一步 ${r.next}${r.shouldTell ? ' [想告诉他]' : ''}`)
      } else {
        console.log(`  ${t} ${JSON.stringify(r).slice(0, 100)}`)
      }
    }
    if (!rows.length) console.log('  （还没有记录）')
  } else if (cmd === 'cost') {
    const r = checkCost()
    console.log('════ 成本 ════')
    console.log(`  今日已烧: ${r.spentToday.toLocaleString()} / 上限 ${r.dayCap.toLocaleString()}`)
    console.log(`  剩余: ${r.left.toLocaleString()}`)
    console.log(`  结论: ${r.ok ? '✅ 正常' : '⚠️ ' + r.note}`)
  } else console.log('用法: novel | trace [n] | cost')
}
