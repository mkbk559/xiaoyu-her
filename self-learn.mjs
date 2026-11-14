/**
 * 她的自由学习循环 —— 自己搜、自己学、自己融
 *
 *   node self-learn.mjs                跑一轮：自主找课 → 学 → 记"能怎么用"
 *   node self-learn.mjs digest         看她的学习账本（学了什么、融合了什么）
 *
 * 2026-11-10 用户指令：「让他自由的去学习，然后就是融合属于自己的内容，
 *   包括视频，skill，什么学习资料」
 *
 * 三个自由：
 *   1) 找什么她自己定：B站知识区排行榜抽帧看 + GitHub 搜 skill + 抖音素材库挑
 *      万赞视频拆解——三路都试，哪个有意思学哪个，每轮 1-2 个，不贪多
 *   2) 学到什么她自己记：笔记里必须有【我怎么用】——学的东西怎么融进
 *      明天的视频（风格/结构/镜头/选题角度），写不出"怎么用"的就不算学会
 *   3) 学完自动进 daily-toon 的风格库/剧情弹药库：skill 学到的风格会加进
 *      STYLES 轮换池，视频拆出来的结构会进"剧情套路"清单
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const HOME = '/opt/her'
const LEDGER = `${HOME}/self-learn.jsonl`
const STYLE_POOL = `${HOME}/toon-episodes/style-pool.json`
const TROPE_POOL = `${HOME}/toon-episodes/trope-pool.json`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const readLines = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])
const readJSON = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return d } }
const writeJSON = (p, j) => writeFileSync(p, JSON.stringify(j, null, 1))

/** 路1：B站知识区——她刷排行榜，抽帧看，觉得有意思就学 */
async function fromBili() {
  const { pick } = await import(`${HOME}/bili-learn.mjs`)
  const { learn } = await import(`${HOME}/video-learn.mjs`)
  let list = []
  try { list = await pick({ n: 6, zone: 'knowledge' }) } catch { return null }
  if (!list.length) return null
  const v = list[Math.floor(Math.random() * list.length)]
  const url = `https://example.com/video/${v.bv}`
  console.log(`  [B站] 挑了 ${v.bv}，抽帧看`)
  try {
    const r = await learn(url, { frames: 6 })
    if (!r || !r.file) return null
    return { source: 'B站', title: r.title, file: r.file, note: r.note?.slice(0, 400) || '' }
  } catch { return null }
}

/** 路2：GitHub——她搜 skill（关键词自己想几个常用的轮换） */
async function fromGitHub() {
  const { search, read: ghRead } = await import(`${HOME}/gh-skill.mjs`)
  const kws = ['video animation skill', 'short video prompt skill', 'storyboard skill', 'image style skill', 'voice tts skill']
  const kw = kws[Math.floor(Math.random() * kws.length)]
  let repos = []
  try { repos = search(kw, 6) } catch { return null }
  // 挑一个没学过的、最近还在更新的
  const learned = new Set(readLines(LEDGER).map(l => l.repo).filter(Boolean))
  const fresh = repos.filter(r => !learned.has(r.full_name) && r.updated > '2026-06')
  const pickd = fresh[0] || repos[0]
  if (!pickd) return null
  console.log(`  [GitHub] 搜「${kw}」挑了 ${pickd.full_name}（★${pickd.stars}）`)
  let r
  try { r = ghRead(pickd.full_name.split('/')[0], pickd.full_name.split('/')[1]) } catch { return null }
  if (!r.chars || r.chars < 500) return null
  const file = `${HOME}/knowledge/skill-${pickd.full_name.replace('/', '-')}.md`
  writeFileSync(file, `# skill: ${pickd.full_name}（★${pickd.stars}）\n_${stamp()}_\n\n${r.text}\n`)
  return { source: 'GitHub', title: pickd.full_name, stars: pickd.stars, file, note: r.text.slice(0, 400) }
}

/** 路3：抖音素材库——拆一条万赞视频的套路 */
function fromDouyin() {
  const lib = readdirSync(`${HOME}/dy-library`).filter(f => f.startsWith('videos-')).flatMap(f => readLines(`${HOME}/dy-library/${f}`))
  const viral = lib.filter(v => (v.like || 0) > 50000).sort((a, b) => (b.like || 0) - (a.like || 0))
  if (!viral.length) return null
  const v = viral[Math.floor(Math.random() * Math.min(3, viral.length))]
  console.log(`  [抖音] 拆万赞视频：${String(v.desc).slice(0, 30)}（${v.like}赞）`)
  return { source: '抖音', title: String(v.desc).slice(0, 60), like: v.like, dur: v.dur, music: v.music,
    note: `结构线索：${String(v.desc).slice(0, 120)}｜时长${v.dur}s｜BGM ${v.music}` }
}

/** 她的脑子：把学到的东西消化成"我怎么用"（写不出就不算学会） */
async function digest(entry) {
  const { writeLong } = await import(`${HOME}/brain.mjs`)
  let planHint = ''
  try { const { readPlanHint } = await import(`${HOME}/her-experience.mjs`); planHint = readPlanHint('learn') } catch { }
  const r = await writeLong([
    '你刚学了一样东西，来源和内容：',
    `【来源】${entry.source}｜${entry.title}`,
    `【内容摘要】${entry.note}`,
    planHint ? `【上次同类事连续栽在这上面，这次换法】${planHint}` : '',
    '',
    '按你的规矩写一页消化笔记：',
    '- 【这是什么】一两句',
    '- 【我觉得有意思的地方】具体说，没意思就说没意思',
    '- 【我怎么用】最重要的一段：这个东西怎么融进你明天的视频——',
    '  是新的画风？新的开头结构？新的镜头语言？新的选题角度？写具体动作。',
    '  **写不出怎么用就直说"用不上"，别硬编。**',
    '- 【值得记的一条】一句话',
    '不超过 200 字。',
  ].join('\n'), { tag: 'self-learn-digest', maxTokens: 700 })
  return r.ok ? r.text : ''
}

/** 融合：把学到的东西写进弹药库（风格池 / 剧情套路池） */
function integrate(entry, note) {
  const integrated = []
  // 风格：消化笔记里出现"画风/风格/风格段"就问一次她的脑子要不要加进风格池（这里简化：GitHub 的 image-style 类直接入池）
  if (/风格|画风|style/i.test(note)) {
    const pool = readJSON(STYLE_POOL, { styles: [] })
    if (pool.styles.length < 12) {
      pool.styles.push({ name: entry.title.slice(0, 24), from: entry.source, learnedAt: stamp() })
      writeJSON(STYLE_POOL, pool)
      integrated.push('风格池+1')
    }
  }
  // 套路：抖音拆解直接进剧情套路池
  if (entry.source === '抖音') {
    const tropes = readJSON(TROPE_POOL, { tropes: [] })
    tropes.tropes.push({ hook: String(entry.title).slice(0, 60), like: entry.like, dur: entry.dur, from: 'self-learn', at: stamp() })
    writeJSON(TROPE_POOL, tropes)
    integrated.push('剧情套路池+1')
  }
  return integrated
}

export async function round() {
  mkdirSync(`${HOME}/knowledge`, { recursive: true })
  const lanes = [fromBili, fromGitHub, fromDouyin]
  // 每轮随机走两路（不贪多）
  const shuffled = lanes.sort(() => Math.random() - 0.5).slice(0, 2)
  const results = []
  for (const lane of shuffled) {
    let entry = null
    try { entry = await lane() } catch (e) { console.log(`  ${lane.name} 失败: ${String(e).slice(0, 60)}`) }
    if (!entry) continue
    console.log(`  消化中…`)
    const note = await digest(entry)
    const integrated = integrate(entry, note)
    const rec = { at: stamp(), ...entry, digested: note.slice(0, 300), integrated, loggedAt: stamp() }
    appendFileSync(LEDGER, JSON.stringify(rec) + '\n')
    results.push(rec)
    console.log(`  ✓ 记账：${entry.source}｜${String(entry.title).slice(0, 30)}｜融合 ${integrated.join(',') || '无'}`)
  }
  return { learned: results.length, results }
}

export function digestLedger() {
  const rows = readLines(LEDGER)
  return {
    总学习数: rows.length,
    按来源: rows.reduce((m, r) => (m[r.source] = (m[r.source] || 0) + 1, m), {}),
    最近: rows.slice(-6).map(r => ({ at: r.at, 来源: r.source, 标题: String(r.title).slice(0, 30), 融合: r.integrated })),
    风格池: readJSON(STYLE_POOL, { styles: [] }).styles.length,
    套路池: readJSON(TROPE_POOL, { tropes: [] }).tropes.length,
  }
}

const cmd = process.argv[2]
if (String(process.argv[1] || '').endsWith('self-learn.mjs')) {
  if (cmd === 'digest') {
    console.log(JSON.stringify(digestLedger(), null, 1))
  } else {
    const r = await round()
    // 2026-11-10 修：带标记的单行 JSON，不 pretty、不截断。
    // 原来输出多行且 slice(0,2500)，day.mjs 取最后一行只拿到 "}" → 每次自由学习都失败。
    console.log('@@RESULT@@' + JSON.stringify(r))
  }
}
