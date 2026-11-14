/**
 * 聊天原始记录落盘（2026-11-11）
 *
 * 用户需求（03-聊天原始记录落盘.txt）：
 *   「把每天和主人的聊天原话落成文件，随时能按关键词翻回去。优先级最高。」
 *
 * 为什么：
 *   上下文满了会被压缩，压缩后只剩几句梗概，细节全丢。
 *   别指望拦住"压缩那一刻"，改成边聊边存：纸一直在，脑子被抹了也能查。
 *
 * 设计：
 *   目录: /opt/her/chats/
 *   文件: YYYY-MM-DD.jsonl（按天）
 *   每行: {at, qq, nick, chatType, groupId, text, msgType}
 *   只追加不覆盖、去重、保留 90 天
 *
 * CLI:
 *   node chat-log.mjs append '<json>'     追加一条
 *   node chat-log.mjs tail [N]            看最近 N 条
 *   node chat-log.mjs search <关键词> [天数]  搜索
 *   node chat-log.mjs stats               统计
 *   node chat-log.mjs prune               清理 90 天前
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync } from 'node:fs'

const HOME = '/opt/her'
const DIR = `${HOME}/chats`
const KEEP_DAYS = 90

const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const today = () => stamp().slice(0, 10)

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}

/** 追加一条聊天记录（去重：同一秒同一QQ同一内容只留一行） */
export function appendChat({ qq, nick, chatType, groupId, text, msgType = 'text', at = null }) {
  ensureDir()
  const rec = {
    at: at || stamp(),
    qq: String(qq || ''),
    nick: String(nick || ''),
    chatType: chatType === 'group' ? 'group' : 'private',
    groupId: groupId ? String(groupId) : null,
    text: String(text || ''),
    msgType: String(msgType || 'text'),
  }
  if (!rec.text && rec.msgType === 'text') return null

  const file = `${DIR}/${rec.at.slice(0, 10)}.jsonl`

  // 去重：读最后 20 行看有没有重复
  try {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-20)
      for (const l of lines) {
        try {
          const old = JSON.parse(l)
          if (old.at === rec.at && old.qq === rec.qq && old.text === rec.text) return null
        } catch { }
      }
    }
  } catch { }

  appendFileSync(file, JSON.stringify(rec) + '\n')
  return rec
}

/** 看最近 N 条 */
export function tailChats(n = 20) {
  ensureDir()
  const files = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()
  const all = []
  for (const f of files.slice(-3)) {   // 最近 3 天够了
    for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean)) {
      try { all.push(JSON.parse(l)) } catch { }
    }
  }
  return all.slice(-n)
}

/** 关键词搜索 */
export function searchChats(keyword, days = 30) {
  ensureDir()
  const kw = String(keyword || '').toLowerCase()
  if (!kw) return []
  const files = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort().slice(-days)
  const hits = []
  for (const f of files) {
    for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(l)
        if (String(r.text || '').toLowerCase().includes(kw)) hits.push(r)
      } catch { }
    }
  }
  return hits
}

/** 按聊天对象过滤 */
export function filterByChat(qq, days = 30) {
  ensureDir()
  const files = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort().slice(-days)
  const hits = []
  for (const f of files) {
    for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean)) {
      try {
        const r = JSON.parse(l)
        if (String(r.qq) === String(qq)) hits.push(r)
      } catch { }
    }
  }
  return hits
}

/** 统计 */
export function chatStats() {
  ensureDir()
  const files = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()
  const out = { files: files.length, total: 0, days: {} }
  for (const f of files) {
    const lines = readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean).length
    out.total += lines
    out.days[f.replace('.jsonl', '')] = lines
  }
  return out
}

/** 清理 90 天前 */
export function pruneChats() {
  ensureDir()
  const files = readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()
  const cutoff = new Date(Date.now() + 8 * 3600 * 1000 - KEEP_DAYS * 86400 * 1000).toISOString().slice(0, 10)
  const removed = []
  for (const f of files) {
    const d = f.replace('.jsonl', '')
    if (d < cutoff) {
      try { unlinkSync(`${DIR}/${f}`); removed.push(f) } catch { }
    }
  }
  return { removed, cutoff, keepDays: KEEP_DAYS }
}

/* ══════ CLI ══════ */
const isMain = String(process.argv[1] || '').endsWith('chat-log.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'tail'

  if (cmd === 'append') {
    const json = process.argv[3] || '{}'
    try {
      const rec = appendChat(JSON.parse(json))
      console.log(rec ? '已记录: ' + rec.at : '跳过（重复或空）')
    } catch (e) { console.log('失败: ' + e.message) }
  }

  if (cmd === 'tail') {
    const n = Number(process.argv[3]) || 20
    const rows = tailChats(n)
    console.log('════ 最近 ' + rows.length + ' 条聊天 ════')
    for (const r of rows) {
      const who = r.chatType === 'group' ? `群${r.groupId}` : r.qq
      console.log(`  ${r.at}  ${who}(${r.nick || '?'}):  ${r.text}`)
    }
  }

  if (cmd === 'search') {
    const kw = process.argv[3] || ''
    const days = Number(process.argv[4]) || 30
    const hits = searchChats(kw, days)
    console.log(`════ 搜索「${kw}」：${hits.length} 条 ════`)
    for (const r of hits.slice(-20)) {
      console.log(`  ${r.at}  ${r.qq}(${r.nick || '?'}):  ${r.text}`)
    }
  }

  if (cmd === 'stats') {
    const s = chatStats()
    console.log('════ 聊天记录统计 ════')
    console.log('  文件数: ' + s.files)
    console.log('  总条数: ' + s.total)
    console.log('  按天:')
    for (const [d, n] of Object.entries(s.days).sort().slice(-10)) {
      console.log(`    ${d}: ${n} 条`)
    }
  }

  if (cmd === 'prune') {
    const r = pruneChats()
    console.log(`清理完成：删除 ${r.removed.length} 个文件（保留 ${r.keepDays} 天，截止 ${r.cutoff}）`)
    for (const f of r.removed) console.log('  - ' + f)
  }
}
