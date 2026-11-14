/**
 * 她的世界感知 her-world.mjs（2026-11-10）
 *
 * 抄的思想：
 *   dsh-time-context → 时间要带时区、带时长（2h13m45s），不是裸时间戳
 *   dsh-schedule     → 日程是结构化的，不是字符串
 *
 * 用户要求「世界感知——只读时间+天气+日程，不接新闻」。
 * 所以这里只做三件事：
 *   1. 时间：现在几点、今天周几、距上次对话多久、她起床多久
 *   2. 天气：洛阳（她所在城市）的天气，只读缓存，不频繁请求
 *   3. 日程：今天该干什么（来自她自己的口述）
 *
 *   node her-world.mjs              看她的世界
 *   node her-world.mjs brief        生成一段"她感知到的世界"（喂给 AIJiYi）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const HOME = '/opt/her'
const CACHE = `${HOME}/her-world-cache.json`
const MIND = `${HOME}/her-mind.json`
// 2026-11-11 加：HOUR_OFFSET 支持（模拟时间用，和 her-mind 一致）
const HOUR_OFFSET = Number(process.env.HOUR_OFFSET || 0)
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000 + HOUR_OFFSET * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const nowCn = () => new Date(Date.now() + 8 * 3600 * 1000 + HOUR_OFFSET * 3600 * 1000)

/* ══════ 1. 时间（抄 dsh-time-context 的 formatDuration） ══════ */
/** 照抄 formatDuration：把毫秒转成 "2h13m45s" */
export function formatDuration(ms) {
  let sec = Math.floor(Math.max(0, ms) / 1000)
  const d = Math.floor(sec / 86400); sec %= 86400
  const h = Math.floor(sec / 3600); sec %= 3600
  const m = Math.floor(sec / 60); sec %= 60
  const parts = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${sec}s`)
  return parts.join('')
}

/** 现在的时间上下文（带时区，照抄 formatTimestamp 的结构） */
export function timeContext() {
  const d = nowCn()
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()]
  const hRaw = d.getUTCHours() + d.getUTCMinutes() / 60
  const fh = process.env.HER_FAKE_HOUR
  const h = (fh && Number.isFinite(Number(fh))) ? Number(fh) : hRaw
  let phase = '深夜'
  if (h >= 5 && h < 9) phase = '早上'
  else if (h >= 9 && h < 12) phase = '上午'
  else if (h >= 12 && h < 14) phase = '中午'
  else if (h >= 14 && h < 18) phase = '下午'
  else if (h >= 18 && h < 22) phase = '晚上'
  else if (h >= 22 && h < 24) phase = '夜里'
  return {
    iso: d.toISOString().slice(0, 19) + '+08:00[Asia/Shanghai]',
    hour: Math.round(h * 100) / 100,
    week: `周${week}`,
    phase,
    isWeekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
  }
}

/* ══════ 2. 天气（只读缓存，别频繁请求） ══════ */
const LUOYANG = { lat: 34.62, lon: 112.45, name: '洛阳' }

/** 用 wttr.in 免费接口，6 小时缓存 */
export async function weather({ force = false } = {}) {
  let cache = null
  if (existsSync(CACHE)) {
    try { cache = JSON.parse(readFileSync(CACHE, 'utf8')) } catch { }
  }
  const fresh = cache && cache.weather && (Date.now() - new Date(cache.weather.at).getTime()) < 6 * 3600 * 1000
  if (fresh && !force) return cache.weather

  try {
    const url = `https://wttr.in/${LUOYANG.name}?format=j1&lang=zh`
    const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'curl/8' } })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    const cur = j.current_condition?.[0] || {}
    const w = {
      at: stamp(),
      city: LUOYANG.name,
      tempC: Number(cur.temp_C) || null,
      desc: cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || '',
      feels: Number(cur.FeelsLikeC) || null,
      humidity: Number(cur.humidity) || null,
      wind: Number(cur.windspeedKmph) || null,
    }
    cache = { ...(cache || {}), weather: w }
    writeFileSync(CACHE, JSON.stringify(cache, null, 2))
    return w
  } catch (e) {
    // 拉不到就用旧的，旧的也没有就返回 null（不编）
    if (cache?.weather) return { ...cache.weather, stale: true }
    return null
  }
}

/* ===== 3. 日程（单一来源：/opt/her/plan.mjs，2026-11-11 统一） ===== */
import { SLOTS as PLAN_SLOTS } from '/opt/her/plan.mjs'
const toHour = hhmm => { const a = hhmm.split(':'); return Number(a[0]) + Number(a[1]) / 60 }
export const SCHEDULE = PLAN_SLOTS.map(s => ({
  from: toHour(s.from), to: toHour(s.to), kind: s.code || s.kind, label: s.label,
  learn: Boolean(s.learn), content: Boolean(s.content), quiet: Boolean(s.quiet),
}))

export function currentSlot() {
  const h = timeContext().hour
  for (const s of SCHEDULE) {
    const inSlot = s.from <= s.to ? (h >= s.from && h < s.to) : (h >= s.from || h < s.to)
    if (inSlot) return s
  }
  return SCHEDULE[0]
}

/* ══════ 4. 精力节律（白天曲线，不是单点状态） ══════ */
/** 一天中的精力系数：早上低、上午高、午后低谷、傍晚回升、夜里掉 */
export function rhythmFactor(hour = timeContext().hour) {
  const curve = [
    { h: 0, f: 0.15 }, { h: 3, f: 0.1 }, { h: 6, f: 0.25 }, { h: 8, f: 0.6 },
    { h: 10, f: 0.95 }, { h: 12, f: 0.8 }, { h: 13.5, f: 0.45 },   // 午后低谷
    { h: 15, f: 0.8 }, { h: 18, f: 0.7 }, { h: 20, f: 0.6 },
    { h: 22, f: 0.75 },   // 写小说时会有一波
    { h: 23.5, f: 0.3 }, { h: 24, f: 0.15 },
  ]
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1]
    if (hour >= a.h && hour < b.h) {
      const t = (hour - a.h) / (b.h - a.h)
      return Math.round((a.f + (b.f - a.f) * t) * 100) / 100
    }
  }
  return 0.3
}

/* ══════ 5. 距上次对话多久 ══════ */
function lastTalkAgo() {
  try {
    if (!existsSync(MIND)) return null
    const m = JSON.parse(readFileSync(MIND, 'utf8'))
    const lastDid = m.today?.did?.slice(-1)?.[0]?.at
    if (!lastDid) return null
    return formatDuration(Date.now() - new Date(lastDid.replace(' ', 'T') + '+08:00').getTime())
  } catch { return null }
}

/* ══════ 6. 生成"她感知到的世界"（喂给 AIJiYi） ══════ */
export async function worldBrief() {
  const t = timeContext()
  const slot = currentSlot()
  const rh = rhythmFactor()
  const w = await weather()

  const parts = []
  parts.push(`现在是${t.iso}，${t.week}${t.phase}`)
  parts.push(`按你的日程，这个点：${slot.label}`)
  if (rh < 0.5) parts.push(`精力只有${Math.round(rh * 100)}%，有点乏`)
  else if (rh > 0.85) parts.push(`精力${Math.round(rh * 100)}%，正得劲`)

  if (w) {
    parts.push(`${w.city}${w.tempC}°C ${w.desc}${w.feels !== null && w.feels !== w.tempC ? `（体感${w.feels}°）` : ''}${w.stale ? '（数据有点旧）' : ''}`)
  } else {
    parts.push('天气查不到（别编）')
  }

  // 2026-11-11 加：外面的世界（抄 Scrapling，用系统 Chrome 抓热搜/新闻）
  try {
    const nb = newsBrief()
    if (nb) parts.push(nb)
  } catch { }

  return parts.join('；')
}

/** 读新闻缓存（Python 脚本 her-world-news.py 写的），失败返回空 */
export function newsBrief() {
  try {
    const p = '/opt/her/her-world-news.json'
    if (!existsSync(p)) return ''
    const j = JSON.parse(readFileSync(p, 'utf8'))
    // 缓存超过 2 小时就不用
    const t = new Date(String(j.at).replace(' ', 'T') + '+08:00').getTime()
    if (!t || Date.now() - t > 2 * 3600 * 1000) return ''
    const parts = []
    if (j.hot?.length) parts.push('热搜：' + j.hot.slice(0, 3).join('、'))
    if (j.news?.length) parts.push('新闻：' + j.news.slice(0, 2).join('、'))
    return parts.length ? '外面在说 —— ' + parts.join('；') : ''
  } catch { return '' }
}

/* ══════ CLI ══════ */
const isMain = String(process.argv[1] || '').endsWith('her-world.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'show'
  if (cmd === 'show') {
    const t = timeContext()
    const slot = currentSlot()
    const rh = rhythmFactor()
    console.log('════ 她的时间 ════')
    console.log(`  ${t.iso}  ${t.week} ${t.phase}`)
    console.log(`  日程: ${slot.label}（${slot.kind}）`)
    console.log(`  精力节律: ${Math.round(rh * 100)}%`)
    console.log()
    console.log('════ 天气 ════')
    const w = await weather()
    if (w) console.log(`  ${w.city} ${w.tempC}°C ${w.desc} 体感${w.feels}° 湿度${w.humidity}%`)
    else console.log('  查不到')
    console.log()
    console.log('════ 完整感知 ════')
    console.log('  ' + await worldBrief())
  } else if (cmd === 'brief') {
    console.log(await worldBrief())
  }
}
