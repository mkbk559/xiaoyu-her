
/**
 * A 的轻量信号（2026-11-12，阶段 2）
 * 只回答一件事：她做/发了内容之后，有没有"到达"——有人回应、或你看了一眼。
 * 不做 KPI、不做涨粉统计（平台登录态也没有，真实互动数据拿不到）。
 *
 *   node her-content-signal.mjs show | json | brief
 * 输出 /opt/her/content-signal.json
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'

const H = '/opt/her'
const OUT = H + '/content-signal.json'
const EP = H + '/toon-episodes'
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const dayOf = s => String(s || '').slice(0, 10)
const readJSON = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }
const readLines = p => {
  try {
    return readFileSync(p, 'utf8').split(String.fromCharCode(10)).filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

/** 最近 14 天：做了什么、试发了几次、你有没有提过 */
function signal() {
  const days = []
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  const eps = existsSync(EP) ? readdirSync(EP).filter(f => f.endsWith('.mp4')) : []
  const chats = []
  if (existsSync(H + '/chats')) {
    for (const f of readdirSync(H + '/chats').sort().slice(-3)) {
      if (f.endsWith('.jsonl')) chats.push(...readLines(H + '/chats/' + f))
    }
  }
  const pubs = readLines(H + '/publish-log.jsonl').concat(readLines(H + '/publish-video.jsonl'))
  const mentions = (fromDate) => chats.filter(r => {
    const d = dayOf(r.at)
    return d >= fromDate && /视频|片子|那一集|发了吗|好看|看了/.test(String(r.text || ''))
  }).length
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10)
    const made = eps.filter(f => f.includes(d.replace(/-/g, ''))).length
    const tried = pubs.filter(p => dayOf(p.at) === d).length
    days.push({ day: d, made, publishTried: tried, herMentionedIt: mentions(d) })
  }
  const made7 = days.reduce((a, b) => a + b.made, 0)
  const tried7 = days.reduce((a, b) => a + b.publishTried, 0)
  const mentioned7 = days.reduce((a, b) => a + b.herMentionedIt, 0)
  const flags = []
  if (made7 > 0 && mentioned7 === 0) flags.push('made-but-unmentioned: 做了 ' + made7 + ' 条内容，最近 7 天你没提过')
  if (made7 === 0) flags.push('no-content: 最近 7 天没做内容')
  return { at: stamp(), days, made7, tried7, mentioned7, flags, healthy: flags.length === 0 }
}

function brief(sig = null) {
  const s = sig || signal()
  return '最近 7 天做了 ' + s.made7 + ' 条内容，试发 ' + s.tried7 + ' 次，你提到过 ' + s.mentioned7 + ' 次'
}

const isMain = String(process.argv[1] || '').endsWith('her-content-signal.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'show'
  const s = signal()
  try { writeFileSync(OUT, JSON.stringify(s, null, 1)) } catch { }
  if (cmd === 'json') console.log(JSON.stringify(s, null, 1))
  else if (cmd === 'brief') console.log(brief(s))
  else {
    console.log('=== A 信号（内容到达）===')
    for (const d of s.days) console.log(d.day + '  做 ' + d.made + ' 条 / 试发 ' + d.publishTried + ' 次 / 你提到 ' + d.herMentionedIt + ' 次')
    console.log('-' , brief(s))
    if (s.flags.length) console.log('⚠️', s.flags.join(' | '))
    else console.log('状态：健康')
  }
}
export { signal, brief }
