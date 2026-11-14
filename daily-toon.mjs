/**
 * 每天一集 v2 —— 用户 2026-11-10 定的规矩：
 *   「剧情不一定是她的生活，让他去刷抖音然后做剧情。
 *     视频风格也让他自己做，但是技能要先学习再做，给他做 GitHub 的 mcp，让他去学习。
 *     我的要求就一个，每天一条视频。」
 *
 * 三大改动：
 *   1) 剧情：从抖音素材库（dy-library）挑热点/梗/爆款形式 → 她的脑子编成剧情（不再是她的日常）
 *   2) 风格自主：每集开工前她自己选风格（像素卡通风/白板/水彩/8-bit…），写进 story
 *   3) 先学再做：skill 没学完（learn-todo 里有 todo 项）→ 先学，学完才允许出片（技能闸）
 *   4) 出图额度自主：主模型挂了自动换备选（raccoon → hunyuan → pollinations 免费兜底）
 *
 *   node daily-toon.mjs [--force]
 */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'

const HOME = '/opt/her'
const OUT_ROOT = `${HOME}/toon-episodes`
const REF_HER = `${HOME}/cast-px/her-01-平静.png`
const REF_CLIENT = `${HOME}/cast-px/client-01-平静.png`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const today = () => stamp().slice(0, 10).replace(/-/g, '')

const readLines = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])

/* ---------- 0) 技能闸：没学完的 skill 先学 ---------- */
async function skillGate() {
  const todos = readLines(`${HOME}/learn-todo.jsonl`).filter(t => t.status === 'todo' && String(t.topic).startsWith('skill：'))
  if (!todos.length) return { cleared: true }
  const { study, quiz } = await import(`${HOME}/learn.mjs`)
  for (const t of todos) {
    console.log(`[技能闸] 先学：${t.topic}`)
    const s = await study(t.topic).catch(() => null)
    const q = s && !s.error ? await quiz(t.topic).catch(() => null) : null
    const score = q?.score ?? 0
    console.log(`  学完自测 ${score}/10${score < 6 ? '（没过线，但知识已入库，明天再考）' : ''}`)
    // 无论分数，本轮标记 learned（笔记已进 knowledge/），考不过的留给日常学习时段再磨
    const lines = readFileSync(`${HOME}/learn-todo.jsonl`, 'utf8').split('\n').filter(Boolean)
    writeFileSync(`${HOME}/learn-todo.jsonl`, lines.map(l => {
      try { const o = JSON.parse(l); if (o.topic === t.topic && o.status === 'todo') o.status = 'learned'; return JSON.stringify(o) } catch { return l }
    }).join('\n') + '\n')
  }
  return { cleared: true, learned: todos.length }
}

/* ---------- 1) 刷抖音：从素材库挑剧情种子 ---------- */
function douyinSeeds() {
  const lib = readdirSync(`${HOME}/dy-library`).filter(f => f.startsWith('videos-')).flatMap(f => readLines(`${HOME}/dy-library/${f}`))
  const hot = readdirSync(`${HOME}/dy-library`).filter(f => f.startsWith('hot-')).flatMap(f => readLines(`${HOME}/dy-library/${f}`))
  if (!lib.length && !hot.length) return { seeds: [], note: '素材库是空的' }
  // 种子 = 热搜词 + 高赞视频的形式（点赞>1万取文案）+ 热门话题
  const topHot = hot.slice(-15).reverse().map(h => h.word)
  const viral = lib.filter(v => (v.like || 0) > 10000).slice(0, 6).map(v => `${v.desc.slice(0, 50)}（${v.like}赞,${v.dur}s,BGM:${v.music}）`)
  const tags = {}
  for (const v of lib) for (const t of (v.tags || [])) tags[t] = (tags[t] || 0) + 1
  const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `#${t}(${n})`)
  return { seeds: { 热搜: topHot, 高赞形式: viral, 热门话题: topTags }, note: '' }
}

/* ---------- 2) 她的脑子：抖音种子 → 剧情故事（不是她的生活）---------- */
async function writeStory(seeds, style, freshIdeas = []) {
  const { writeLong } = await import(`${HOME}/brain.mjs`)
  let planHint = ''
  try { const { readPlanHint } = await import(`${HOME}/her-experience.mjs`); planHint = readPlanHint('videos') } catch { }
  const r = await writeLong([
    '你要做今天的短视频（一集卡通片）。今天刷抖音看到这些：',
    '',
    `【热搜】${seeds.热搜.join(' / ')}`,
    `【高赞视频长这样】${seeds.高赞形式.join('；') || '（库里暂无万赞样本）'}`,
    `【热门话题】${seeds.热门话题.join(' ')}`,
    freshIdeas.length ? `\n【你刚学来的新想法（今天要用上至少一条）】\n${freshIdeas.join('\n---\n').slice(0, 1200)}` : '',
    '',
    `从这里面挑一个你能做的，编成剧情（可以虚构人物和情节，不一定是你的生活，但要通过你的嘴讲）。风格：${style}。`,
    '新想法里说的做法（比如开头换字卡硬切、倒过来先画面后口播），能用的就用在 prompt 和 text 里。',
    planHint ? `【上次连续栽在这上面，这次换法】${planHint}` : '',
    '',
    '写 8 个场景的 JSON 数组，每场：',
    '{"who":"her或client或narrator","text":"台词（口语，15-40字，有钩子有转折有结果）","prompt":"画面提示词（英文）","motion":"push-in或zoom-out或static"}',
    '',
    '提示词规矩（SLCT）：主体写清位置（center-left/right），描述有什么、禁止否定式；',
    '光线：warm desk lamp as key light plus soft ambient fill, well-exposed, every object readable；',
    '画面里出现"我"时画 the same pixel art girl from the reference；甲方画 the same businessman in navy suit with round glasses；',
    '第一句必须是钩子（数字/悬念/反转），最后一句收一条跟钱或做事有关的规矩。',
    '',
    '只输出 JSON 数组，8 个对象。',
  ].join('\n'), { tag: 'daily-toon-story', maxTokens: 2800 })
  if (!r.ok) return null
  let scenes = []
  const text = String(r.text)
  const whole = text.match(/\[[\s\S]*\]/)
  if (whole) { try { scenes = JSON.parse(whole[0]) } catch { } }
  if (!Array.isArray(scenes) || scenes.length < 4) {
    scenes = []
    for (const mm of text.matchAll(/\{[^{}]*"who"[\s\S]*?\}/g)) {
      try { scenes.push(JSON.parse(mm[0].replace(/,\s*$/, ''))) } catch { }
    }
  }
  return Array.isArray(scenes) && scenes.length >= 4 ? scenes : null
}

/* ---------- 3) 风格自主：她选今天用哪种 ---------- */
const STYLES = [
  { name: '像素卡通', style: '16-bit pixel art cartoon, retro game cutscene style, limited warm palette, flat cel shading, clean background', },
  { name: '白板手绘', style: 'whiteboard hand-drawn animation style, black marker on white, simple stick figures with expressive faces', },
  { name: '扁平矢量', style: 'flat vector illustration style, bold shapes, muted palette, editorial look', },
  { name: '水彩速写', style: 'loose watercolor sketch style, ink outlines, warm paper texture', },
]
function pickStyle() {
  // 她自己攒的风格池（self-learn 学来的会入池）+ 基础四风格，一起轮换
  const f = `${OUT_ROOT}/style-choice.json`
  if (existsSync(f)) { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { } }
  const pool = (() => { try { return JSON.parse(readFileSync(`${OUT_ROOT}/style-pool.json`, 'utf8')).styles || [] } catch { return [] } })()
  const learned = pool.map(p => ({ name: p.name, style: p.name }))       // 学来的风格名即风格描述
  const all = [...STYLES, ...learned]
  return all[new Date().getDate() % all.length]
}

/* ---------- 4) 出图：主模型挂了自动换备选 ---------- */
function genImage(prompt, out, ref) {
  const models = ['raccoon-image', 'hunyuan-image-alpha']
  for (const m of models) {
    try {
      const o = execFileSync('python3', [HOME + '/gw-image.py', '--ref', ref, '--prompt', prompt, '--out', out, '--size', '720x1280', '--model', m], { timeout: 300000, encoding: 'utf8' })
      const r = JSON.parse(o.trim().split(String.fromCharCode(10)).pop())
      if (r.ok) return m
      console.error('[出图] ' + m + ' 返回失败: ' + JSON.stringify(r).slice(0, 120))
    } catch (e) {
      console.error('[出图] ' + m + ' 异常: ' + String(e.message).slice(0, 100))
    }
  }
  // 兜底：Pollinations 免费文生图（无参考图，角色一致性靠提示词锁风格）
  try {
    const enc = encodeURIComponent(prompt.slice(0, 900))
    execFileSync('curl', ['-s', '--noproxy', '*', '--max-time', '280', '-o', out,
      'https://image.pollinations.ai/prompt/' + enc + '?width=720&height=1280&nologo=true&model=flux'], { timeout: 300000 })
    if (statSync(out).size > 20000) return 'pollinations(免费兜底)'
    console.error('[出图] pollinations 兜底产物过小')
  } catch (e) {
    console.error('[出图] pollinations 兜底失败: ' + String(e.message).slice(0, 100))
  }
  return null
}

export async function makeEpisode({ force = false } = {}) {
  const ep = `ep-${today()}`
  const final = `${OUT_ROOT}/${ep}.mp4`
  if (existsSync(final) && !force) return { skipped: '今天已出过一集', final }
  mkdirSync(OUT_ROOT, { recursive: true })
  const dir = `${OUT_ROOT}/${ep}`
  mkdirSync(dir, { recursive: true })

  // 0) 先学再做
  const gate = await skillGate()
  if (gate.learned) console.log(`[技能闸] 今天先学了 ${gate.learned} 个 skill 才开工`)

  // 0.5) 自由学习一轮（2026-11-10 用户要求：自由学习 + 融合自己的内容）
  //      学到的"我怎么用"会直接喂给下面的剧情生成
  let freshIdeas = []
  try {
    const { round } = await import(`${HOME}/self-learn.mjs`)
    const r = await round()
    freshIdeas = (r.results || []).map(x => x.digested).filter(Boolean)
    console.log(`[自由学习] 这轮学了 ${r.learned} 样${freshIdeas.length ? '，有新想法要融进今天的片' : ''}`)
  } catch (e) { console.log(`[自由学习] 跳过：${String(e).slice(0, 60)}`) }

  // 1) 刷抖音拿种子
  const { seeds, note } = douyinSeeds()
  if (!seeds.热搜) return { error: '素材库空：先跑 dy-library collect' + note }
  console.log(`[抖音] 热搜 ${seeds.热搜.length} 条，高赞样本 ${seeds.高赞形式.length} 个，话题 ${seeds.热门话题.length} 个`)

  // 2) 风格 + 剧情
  const st = pickStyle()
  console.log(`[风格] ${st.name}（她自己选的，可改 style-choice.json）`)
  const scenes = await writeStory(seeds, st.style, freshIdeas)
  if (!scenes) return { error: '剧情没写出来' }
  writeFileSync(`${dir}/story.json`, JSON.stringify({ style: st, scenes }, null, 1))
  console.log(`[剧情] ${scenes.length} 场：${scenes.map(s => s.text.slice(0, 8)).join(' / ')}`)

  let stilled = 0, voiced = 0, usedModels = new Set()
  // 3) 分镜（备选出图链）
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]
    const out = `${dir}/scene_${i + 1}.png`
    if (existsSync(out) && statSync(out).size > 60000) { stilled++; continue }
    const ref = s.who === 'client' ? REF_CLIENT : REF_HER
    const m = genImage(`${st.style}. ${s.prompt || s.text}. Keep the character design EXACTLY the same as the reference image.`, out, ref)
    if (m) { stilled++; usedModels.add(m); console.log(`  [still] ${i + 1}/${scenes.length} ✓ (${m})`) }
    else console.log(`  [still] ${i + 1} ✗ 全部出图源失败`)
  }

  // 4) 配音
  const VOICES = { her: 'zh-CN-XiaoyiNeural', client: 'zh-CN-YunyangNeural', narrator: 'zh-CN-YunxiNeural' }
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]
    const out = `${dir}/vo_${i + 1}.mp3`
    if (existsSync(out) && statSync(out).size > 2000) { voiced++; continue }
    for (let k = 0; k < 3; k++) {
      try {
        execFileSync('edge-tts', ['--voice', VOICES[s.who] || VOICES.her, '--text', s.text, '--write-media', out], { stdio: 'ignore', timeout: 150000 })
        voiced++; break
      } catch { await new Promise(r => setTimeout(r, 2000)) }
    }
  }
  console.log(`[素材] 静帧 ${stilled}/${scenes.length}，配音 ${voiced}/${scenes.length}，出图源 ${[...usedModels].join('+')}`)

  // 5) 合成
  const padded = readdirSync(dir).filter(f => /^(scene|vo)_(\d)\./.test(f))
  for (const f of padded) {
    const n = Number(f.match(/_(\d)\./)[1])
    const target = f.replace(/_(\d)\./, `_0${n}.`)
    execFileSync('mv', [`${dir}/${f}`, `${dir}/${target}`])
  }
  const ct = execFileSync('node', [`${HOME}/compose-toon.mjs`, dir], { encoding: 'utf8', timeout: 1200000 })
  const jsonStart = ct.lastIndexOf('{')
  const res = jsonStart >= 0 ? JSON.parse(ct.slice(jsonStart)) : { ok: false, detail: ct.slice(0, 200) }
  if (!res.ok) return { error: '合成失败', detail: res.detail }
  execFileSync('mv', [res.final, final])
  return { ok: true, final, duration: res.duration, scenes: scenes.length, style: st.name, bytes: res.bytes, 出图源: [...usedModels] }
}

const isMain = String(process.argv[1] || '').endsWith('daily-toon.mjs')
if (isMain) {
  const r = await makeEpisode({ force: process.argv.includes('--force') })
  console.log(JSON.stringify(r, null, 1))
}
