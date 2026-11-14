/**
 * 她真"看"视频：下载 → 抽帧 → 逐帧看图 + 读字幕 → 学成笔记
 *
 *   node video-learn.mjs watch "<B站链接>"            看一个视频（抽帧+视帧描述+字幕）
 *   node video-learn.mjs learn "<链接>" [--frames 6]  看完写一页笔记进 knowledge
 *   node video-learn.mjs log                          看她看过什么
 *
 * 两台引擎一起上（这是关键）：
 *   1) **抽帧看画面**（用户 2026-11-09 要求）：yt-dlp 下低清 → ffmpeg 抽帧 → glm-4.6v 逐帧描述 + RapidOCR 读画面文字
 *   2) **字幕/元数据**：yt-dlp，沿用你仓库 aiji/senses/video_ingest.py 的做法与坑
 *      - 必须 `--proxy ""`（你仓库注明本机 7897 是死代理，走它直接 ConnectionRefused）
 *      - 字幕要登录态；拿不到就如实记"没字幕"，只靠画面
 *      - 弹幕不进记忆（信噪比太低，你仓库的判断）
 */
import { spawn, execSync, execFileSync } from 'node:child_process'
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { writeLong, see, ocr } from '/opt/her/brain.mjs'

const HOME = '/opt/her'
const VID = `${HOME}/video-work`
const LOG = `${HOME}/video-log.jsonl`
const KNOW = `${HOME}/knowledge`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const readLines = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])

const DEFAULT_COOKIES = `${HOME}/cookies-bili.txt`

/** yt-dlp 参数：cookies 让字幕能下（B站字幕需登录）；proxy "" 是必须的（本机 7897 是死代理） */
function ytBase() {
  const a = ['--proxy', '']
  if (existsSync(DEFAULT_COOKIES)) a.push('--cookies', DEFAULT_COOKIES)
  return a
}

/** 元数据：标题 / 时长 / UP */
function meta(url) {
  try {
    const out = execFileSync('yt-dlp', [...ytBase(), '--skip-download', '--print',
      '%(title)s\t%(duration)s\t%(uploader)s\t%(webpage_url)s', url], { encoding: 'utf8', timeout: 60000 })
    const [title, duration, uploader] = out.trim().split('\t')
    return { title, duration: Number(duration) || 0, uploader }
  } catch (e) { return { error: String(e.message).slice(0, 200) } }
}

/** 拿字幕并转成纯文本（她的讲解来源，比画面更完整） */
function fetchSubs(url, dir) {
  try {
    execFileSync('yt-dlp', [...ytBase(), '--skip-download', '--write-subs', '--write-auto-subs',
      '--sub-langs', 'zh-Hans,zh-CN,ai-zh,zh', '--convert-subs', 'srt',
      '-o', `${dir}/sub.%(ext)s`, url], { encoding: 'utf8', timeout: 120000, stdio: 'ignore' })
  } catch { /* 有些视频就是没字幕 */ }
  const f = existsSync(dir) ? readdirSync(dir).find(x => x.startsWith('sub.') && x.endsWith('.srt')) : null
  if (!f) return { text: '', file: null, note: '这个视频没有字幕（或需要更高权限）' }
  const raw = readFileSync(`${dir}/${f}`, 'utf8')
  const lines = raw.split('\n')
    .filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes('-->'))
    .map(l => l.trim())
  // 去重相邻重复（自动字幕常重复）
  const out = []
  for (const l of lines) if (out[out.length - 1] !== l) out.push(l)
  return { text: out.join(' ').slice(0, 6000), file: `${dir}/${f}`, note: '' }
}

/** 在指定秒数抽 1 帧；返回路径或 null */
function frameAt(file, dir, sec, tag) {
  const p = `${dir}/x-${tag}.jpg`
  try {
    execFileSync('ffmpeg', ['-y', '-ss', String(Math.max(0, sec)), '-i', file, '-frames:v', '1',
      '-vf', 'scale=720:-2', p], { stdio: 'ignore', timeout: 60000 })
    return existsSync(p) ? p : null
  } catch { return null }
}

/** 挑画质最低的视频流下载（抽帧不需要清晰） */
function download(url, dir) {
  mkdirSync(dir, { recursive: true })
  let best = null
  try {
    const list = execFileSync('yt-dlp', ['--proxy', '', '--list-formats', url], { encoding: 'utf8', timeout: 60000 })
    const rows = list.split('\n').map(l => l.trim()).filter(l => /^\d+\s+mp4/.test(l))
    for (const r of rows) {
      const m = r.match(/^(\d+)\s+mp4\s+(\d+)x(\d+)/)
      if (!m) continue
      const px = Number(m[2]) * Number(m[3])
      if (!best || px < best.px) best = { id: m[1], px }
    }
  } catch (e) { /* 列不出就退回默认 */ }
  const args = [...ytBase(), '-o', 'v.%(ext)s', '--no-playlist', url]
  if (best) args.splice(args.length - 4, 0, '-f', best.id)
  try {
    execFileSync('yt-dlp', args, { cwd: dir, encoding: 'utf8', timeout: 240000, stdio: 'ignore' })
    const f = readdirSync(dir).find(x => x.startsWith('v.'))
    return { ok: !!f, file: f ? `${dir}/${f}` : null, format: best ? best.id : 'auto' }
  } catch (e) { return { error: String(e.message).slice(0, 200) } }
}

/** 抽帧 */
function frames(file, dir, n) {
  try {
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim())
    const every = Math.max(5, Math.floor(dur / (n + 1)))
    execFileSync('ffmpeg', ['-y', '-i', file, '-vf', `fps=1/${every},scale=640:-2`,
      '-frames:v', String(n), `${dir}/f-%02d.jpg`], { stdio: 'ignore', timeout: 120000 })
    return { every, files: readdirSync(dir).filter(f => f.startsWith('f-') && f.endsWith('.jpg')).sort().map(f => `${dir}/${f}`) }
  } catch (e) { return { error: String(e.message).slice(0, 160), files: [] } }
}

/** 看一个视频：字幕（讲解）+ 画面（逐帧描述 + 画面文字），看不清的帧会自动补抽 */
export async function watch(url, { frames: n = 6 } = {}) {
  rmSync(VID, { recursive: true, force: true })
  const m = meta(url)
  if (m.error) return { error: '元数据失败: ' + m.error, url }
  const dl = download(url, VID)
  if (!dl.ok) return { error: '下载失败: ' + (dl.error || '未知'), url, meta: m }
  const subs = fetchSubs(url, VID)
  const fr = frames(dl.file, VID, n)
  const observations = []
  const seeFrame = async (f) => {
    const b64 = readFileSync(f).toString('base64')
    const v = await see(b64, '用一句话说这一帧里能看到什么（人/场景/动作/物件），画面上的字也读出来，看不清就说看不清，别猜')
    const o = await ocr(b64)
    return {
      frame: f.split('/').pop(),
      vision: v.ok ? v.text.slice(0, 200) : '',
      text_in_frame: o.ok ? o.text.slice(0, 200) : '',
    }
  }
  for (const f of fr.files) {
    const r = await seeFrame(f)
    observations.push(r)
    console.log(`  · ${r.frame} 画面:${r.vision.slice(0, 50)} 字:${r.text_in_frame.slice(0, 30)}`)
  }
  // —— 看不清就多抽帧（用户 2026-11-09 要求）——
  // 判断标准：**视觉模型没描述出画面**就算看不清（OCR 只读到水印/字幕条不算"看清了画面"）
  const blanks = observations.filter(o => !o.vision)
  let extra = 0
  for (const b of blanks) {
    const i = Number(String(b.frame).match(/(\d+)/)?.[1] || 1)
    const center = i * fr.every
    for (const off of [-10, 10, -20, 20]) {          // 前后各试两档，补到能看清为止
      const f = frameAt(dl.file, VID, center + off, `${i}-${off > 0 ? 'b' : 'a'}${Math.abs(off)}`)
      if (!f) continue
      const r = await seeFrame(f)
      r.fromBlank = b.frame
      observations.push(r)
      extra++
      const okNow = !!(r.vision || r.text_in_frame)
      console.log(`  · 补抽 ${r.frame}（原帧 ${b.frame} 看不清，偏移 ${off}s）画面:${r.vision.slice(0, 40) || '（仍看不清）'}`)
      if (okNow) break
    }
  }
  const rec = {
    at: stamp(), url, title: m.title, duration: m.duration, uploader: m.uploader,
    format: dl.format, frames: observations.length, planned_frames: fr.files.length,
    extra_frames: extra, every_s: fr.every,
    subtitle_chars: (subs.text || '').length, subtitle_note: subs.note,
    subtitle_file: subs.file, subtitle_text: (subs.text || '').slice(0, 2000),
    observations,
  }
  appendFileSync(LOG, JSON.stringify(rec) + '\n')
  return rec
}

/** 看完写笔记：字幕（讲解）+ 画面（逐帧看到的东西）一起消化 */
export async function learn(url, { frames: n = 6 } = {}) {
  mkdirSync(KNOW, { recursive: true })
  const w = await watch(url, { frames: n })
  if (w.error) return w
  const material = w.observations.map((o, i) =>
    `${i + 1}. [${o.frame}${o.fromBlank ? '·补抽' : ''}] 画面：${o.vision || '（还是看不清）'}\n   画面上的字：${o.text_in_frame || '（没有字）'}`
  ).join('\n')
  const prompt = [
    `你刚在 B站 看完一个视频：《${w.title}》（UP：${w.uploader || '未知'}，${Math.round(w.duration / 60)} 分钟，抽了 ${w.frames} 帧${w.extra_frames ? '，其中' + w.extra_frames + '帧是看不清补抽的' : ''}）。`,
    '',
    w.subtitle_chars > 0
      ? `【他讲的话（字幕，${w.subtitle_chars} 字）】\n${w.subtitle_text.slice(0, 3000)}`
      : `【字幕】${w.subtitle_note || '这个视频没有字幕'}——你只能靠画面判断，判断不了就说判断不了`,
    '',
    '【你看到的画面】', material, '',
    '按你的习惯写一页笔记，硬要求：',
    '- 有字幕就以字幕为准讲"他在说什么"，画面只用来印证；没字幕就明说"没字幕，只能看画面"',
    '- 看不清的地方写"看不清"，**绝不编**',
    '- 【视频在讲什么】1–2 句',
    '- 【他讲到的关键点】最多 5 条（有字幕就从字幕里挑真的，没字幕就别硬凑）',
    '- 【这对我接活有什么用】2 条（要具体到"下次遇到XX活我能怎么做"）',
    '- 【我要去验证什么】2 条',
    '- 用你自己的话，别写"该视频讲述了"这类套话',
  ].join('\n')
  const r = await writeLong(prompt, { tag: 'video-learn', maxTokens: 1800 })
  if (!r.ok) return { error: r.error || 'model failed', watched: w }
  const safe = String(w.title || url).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '-').slice(0, 40)
  const file = `${KNOW}/看视频-${safe}.md`
  writeFileSync(file, `# 看视频学的：《${w.title}》\n\n_看于 ${stamp()} · ${w.frames} 帧（每 ${w.every_s}s${w.extra_frames ? '，补抽 ' + w.extra_frames + ' 帧' : ''}）· 字幕 ${w.subtitle_chars} 字 · ${url}_\n\n${r.text}\n`)
  return { url, title: w.title, frames: w.frames, extra_frames: w.extra_frames, subtitle_chars: w.subtitle_chars, note: r.text, file, tokens: r.tokens }
}

const cmd = process.argv[2]
if (String(process.argv[1] || '').endsWith('video-learn.mjs')) {
  const fi = process.argv.indexOf('--frames')
  const nf = fi > 0 ? Number(process.argv[fi + 1]) : 6
  if (cmd === 'watch') console.log(JSON.stringify(await watch(process.argv[3], { frames: nf }), null, 1).slice(0, 2500))
  else if (cmd === 'learn') console.log(JSON.stringify(await learn(process.argv[3], { frames: nf }), null, 1).slice(0, 2500))
  else if (cmd === 'log') console.log(JSON.stringify(readLines(LOG).slice(-8), null, 1))
  else console.log('用法: watch <链接> [--frames 6] | learn <链接> | log')
}
