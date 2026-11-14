
/**
 * 知识检索（2026-11-12，阶段 2）
 * 从 /opt/her/knowledge/*.md 里按关键词取 top-k 片段，用于聊天上下文注入。
 * 设计约束：只读、懒加载、总注入字符有上限、失败不影响聊天。
 *
 *   node her-knowledge.mjs "接单 报价"     看检索结果
 */
import { readFileSync, readdirSync } from 'node:fs'

const K = '/opt/her/knowledge'
const MAX_CHUNK = 420
const MAX_TOTAL = 640

let CHUNKS = null
function load() {
  if (CHUNKS) return CHUNKS
  CHUNKS = []
  for (const f of readdirSync(K)) {
    if (!f.endsWith('.md') || f === 'INDEX.md') continue
    let t = ''
    try { t = readFileSync(K + '/' + f, 'utf8') } catch { continue }
    const title = (t.match(/^#\s*(.+)/) || [])[1] || f
    const paras = t.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length >= 80)
    for (const p of paras) {
      if (p.startsWith('|') || p.startsWith('>')) continue
      // 阶段 2 护栏：含「她的世界没有 AI」类词的片段不注入，避免污染她的话
      if (/语言模型|大模型|人工智能|AI助手|提示词|插件/.test(p)) continue
      CHUNKS.push({ title: title.trim(), file: f, text: p.slice(0, MAX_CHUNK) })
    }
  }
  return CHUNKS
}

function terms(q) {
  const out = new Set()
  const s = String(q || '').toLowerCase()
  for (const w of s.match(/[a-z0-9]{2,}/g) || []) out.add(w)
  const zh = s.replace(/[^\u4e00-\u9fa5]/g, '')
  for (let i = 0; i + 2 <= zh.length; i++) out.add(zh.slice(i, i + 2))
  return [...out]
}

function score(chunk, ts) {
  const text = (chunk.title + ' ' + chunk.text).toLowerCase()
  let n = 0
  for (const t of ts) if (text.includes(t)) n++
  if (n === 0) return 0
  return n / Math.sqrt(chunk.text.length / 100 + 1)
}

export function retrieve(query, { k = 3 } = {}) {
  const ts = terms(query)
  if (!ts.length) return []
  const scored = []
  for (const c of load()) {
    const s = score(c, ts)
    if (s > 0) scored.push([s, c])
  }
  scored.sort((a, b) => b[0] - a[0])
  const out = []
  for (const [s, c] of scored) {
    if (out.length >= k) break
    if (out.some(o => o.file === c.file && o.text.slice(0, 40) === c.text.slice(0, 40))) continue
    out.push({ score: Math.round(s * 100) / 100, title: c.title, file: c.file, text: c.text })
  }
  return out
}

/** 给聊天上下文用：一句紧凑的资料摘要（超预算就截断） */
export function brief(query) {
  const hits = retrieve(query, { k: 2 })
  if (!hits.length) return ''
  const parts = hits.map(h => h.title + '：' + h.text)
  let s = parts.join(' ｜ ')
  if (s.length > MAX_TOTAL) s = s.slice(0, MAX_TOTAL) + '…'
  return s
}

const isMain = String(process.argv[1] || '').endsWith('her-knowledge.mjs')
if (isMain) {
  const q = process.argv.slice(2).join(' ')
  if (!q) { console.log('用法: node her-knowledge.mjs "关键词"'); process.exit(0) }
  const t0 = Date.now()
  const hits = retrieve(q, { k: 3 })
  console.log(JSON.stringify({ query: q, ms: Date.now() - t0, chunks: load().length, hits }, null, 1))
}
