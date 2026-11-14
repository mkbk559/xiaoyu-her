/**
 * 她的小说 —— 2026-11-13 改：质量门真拦（选项 A）
 *
 *   node write-novel.mjs            今天的写作时段跑一次（跑过跳过）
 *   node write-novel.mjs --force    强制再写
 *   node write-novel.mjs status     看进度
 *
 * 改了什么（2026-11-13 22:5x，用户拍板 A）：
 *   原版：写出来就直接追加进正文，质量门（her-verify.checkNovel）事后只记账 → 今天 8 段里 7 段判 fail 却全落盘。
 *   现在：写 → checkNovelText(候选文本) → 不过就把 problems 喂回去重写（最多 3 次）
 *         → 3 次都不过 → 存 novel/废稿/ 并记 废稿/记录.jsonl，正文一个字都不写。
 *
 * 规矩不变：
 *   · 延续上下文：喂最近 2500 字 + 剧情状态行
 *   · 每段 800–1500 字，存 正文/YYYY-MM-DD.md，进度记 进度.json
 *   · 这是她自己的东西——写什么她定
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync, unlinkSync } from 'node:fs'

const HOME = '/opt/her'
const DIR = HOME + '/novel'
const TEXT = DIR + '/正文'
const DRAFT = DIR + '/废稿'
const PROG = DIR + '/进度.json'
const SETTING = DIR + '/设定.md'
const MAX_TRIES = 3
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const today = () => stamp().slice(0, 10)

const DEFAULT_PROG = { premise: '都市奇幻，主角在普通生活里偶然发现自己能操控时间。', charsBefore: 30000, charsWritten: 0, days: 0, lastAt: '', beats: [] }

function loadProg() { try { return { ...DEFAULT_PROG, ...JSON.parse(readFileSync(PROG, 'utf8')) } } catch { return { ...DEFAULT_PROG } } }
function saveProg(p) { writeFileSync(PROG, JSON.stringify(p, null, 2)) }

/** 最近 N 字正文（延续用） */
function recentText(n = 2500) {
  if (!existsSync(TEXT)) return ''
  const files = readdirSync(TEXT).filter(f => f.endsWith('.md')).sort()
  let out = ''
  for (let i = files.length - 1; i >= 0 && out.length < n; i--) {
    out = readFileSync(`${TEXT}/${files[i]}`, 'utf8') + out
  }
  return out.slice(-n)
}

/** 清掉 AI 自带的标题行 + 压空行（原版逻辑，挪出来复用） */
function cleanBody(raw) {
  return String(raw || '')
    .split('\n')
    .filter(line => !/^\s*#{1,3}\s/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 拼提示词；problems 非空时把上一版没过的地方喂回去 */

/** 2026-11-13 Step2-2C：读计划段写下的 override 提示（读过即消费） */
export function readPlanHint() {
  const hp = HOME + '/her-plan-hint.json'
  try {
    if (!existsSync(hp)) return ''
    const h = JSON.parse(readFileSync(hp, 'utf8'))
    if (h.goal && h.goal !== 'novel') return ''
    try { unlinkSync(hp) } catch (e) { }
    return String(h.hint || '')
  } catch { return '' }
}

function buildPrompt(prog, recent, beats, problems, hint) {
  const parts = [
    '现在是你的写作时间（22:30–23:30，猫在旁边）。接着写你的小说。',
    '',
    `【设定】${prog.premise}`,
    beats ? `【最近的剧情走向】${beats}` : '（刚开始记录，从你想写的地方接下去）',
    recent ? `【最近的正文（接着写，别重复）】\n...${recent}` : '（还没有存档的正文，从三万字之后的情节开始）',
    '',
    '写今天这一段，要求：',
    '- 800 到 1500 字，小说正文，不是大纲',
    '- 保持你自己的语感和节奏，写你上次没写完的地方',
    '- **只写正文**。不要写任何标题、日期、章节名（比如 "## 2026-11-12" 这种绝对不要）',
    '- 写完之后另起一行，用「【今日剧情】」开头，一两句话记今天这段推进了什么（这条进进度档案，不进正文）',
  ]
  if (problems && problems.length) {
    parts.push('')
    parts.push(`【上一版没过质量门，这次必须改掉这些】${problems.join('；')}`)
    parts.push('（这是重写，不是修补上一版；上一版已经作废，别照着它改字面）')
  }
  if (hint) {
    parts.push('')
    parts.push(`【这次换个办法，别再撞上次那个坑】${hint}`)
  }
  return parts.join('\n')
}

export async function writeOnce({ force = false } = {}) {
  mkdirSync(TEXT, { recursive: true })
  if (!existsSync(SETTING)) {
    writeFileSync(SETTING, [
      '# 她的小说（设定）',
      '',
      '_2026-11-10 她本人口述：「都市奇幻，主角在普通生活里偶然发现自己能操控时间。现在大约三万字，想继续往下写。」_',
      '',
      '书名：未定（她没说）',
      '类型：都市奇幻',
      '已有：约三万字（之前写的没存档，从现在开始每天记录）',
      '主角：普通人，能操控时间',
    ].join('\n'))
  }
  const prog = loadProg()
  // 同一小时只写一次（原版规矩，保留）
  const _lastHour = String(prog.lastAt || '').slice(0, 13)
  const _nowHour = stamp().slice(0, 13)
  if (_lastHour && _lastHour === _nowHour && !force) return { skipped: '这一小时写过了', prog }

  const { writeLong } = await import(`${HOME}/brain.mjs`)
  const { checkNovelText } = await import(`${HOME}/her-verify.mjs`)
  const recent = recentText()
  const beats = (prog.beats || []).slice(-5).join('；')

  let problems = []
  let body = ''
  let beat = ''
  let lastDraft = ''
  let tries = 0

  for (let i = 0; i < MAX_TRIES; i++) {
    tries++
    const hint = tries === 1 ? readPlanHint() : ''
    const r = await writeLong(buildPrompt(prog, recent, beats, problems, hint), { tag: 'novel-write', maxTokens: 3600 })
    if (hint) console.log('[override] 这次用了换法提示：' + hint.slice(0, 40))
    if (!r.ok) return { error: '写作失败: ' + String(r.error || '').slice(0, 100), tries }
    const full = String(r.text)
    const bi = full.indexOf('【今日剧情】')
    const cand = cleanBody(bi >= 0 ? full.slice(0, bi) : full)
    const b = bi >= 0 ? full.slice(bi).replace('【今日剧情】', '').trim().slice(0, 120) : ''
    lastDraft = cand
    const q = checkNovelText(cand)
    if (q.ok) { body = cand; beat = b; problems = []; break }
    problems = q.problems
    console.log(`[质量门] 第 ${tries} 次没过：${problems.join('；')}`)
  }

  // 三次都不过 → 进废稿，正文不动
  if (!body) {
    mkdirSync(DRAFT, { recursive: true })
    const df = `${DRAFT}/${today()}-${stamp().slice(11, 16).replace(':', '')}.md`
    writeFileSync(df, `# 废稿 ${stamp()}\n\n**没过质量门的原因**：${problems.join('；')}\n\n---\n\n${lastDraft}\n`)
    try { appendFileSync(`${DRAFT}/记录.jsonl`, JSON.stringify({ at: stamp(), tries, chars: lastDraft.length, problems, file: df }) + '\n') } catch { }
    console.log(`[质量门] 三次都没过，存废稿：${df}`)
    return { error: 'quality(' + problems.join('；') + ')', tries, draftFile: df, chars: lastDraft.length }
  }

  const file = `${TEXT}/${today()}.md`
  // 同一天多次写 -> 追加，不覆盖
  if (existsSync(file)) {
    writeFileSync(file, readFileSync(file, 'utf8').trimEnd() + `\n\n## 又一段（${stamp().slice(11, 16)}）\n\n${body}\n`)
  } else {
    writeFileSync(file, `# ${today()}\n\n${body}\n`)
  }
  prog.charsWritten += body.length
  prog.days += 1
  prog.lastAt = stamp()
  if (beat) prog.beats = [...(prog.beats || []), `${today()}: ${beat}`].slice(-30)
  saveProg(prog)
  return { ok: true, file, chars: body.length, totalWritten: prog.charsWritten, days: prog.days, beat, tries, charsBefore: prog.charsBefore }
}

export function status() {
  const p = loadProg()
  const files = existsSync(TEXT) ? readdirSync(TEXT).filter(f => f.endsWith('.md')).sort() : []
  return { ...p, 存档天数: files.length, 最近文件: files.slice(-3), 估算总字数: p.charsBefore + p.charsWritten }
}

const cmd = process.argv[2]
if (String(process.argv[1] || '').endsWith('write-novel.mjs')) {
  if (cmd === 'status') console.log(JSON.stringify(status(), null, 1))
  else console.log(JSON.stringify(await writeOnce({ force: cmd === '--force' }), null, 1))
}
