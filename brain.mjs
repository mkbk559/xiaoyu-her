/**
 * 她的脑子 v2 —— 两个入口，各管一件事
 *
 *   ① 记忆 + 对话 + 人格：AIJiYi（本机 8787，OpenAI 兼容，model=aiji）
 *      → 每次调用自动做：快召回 → 记忆注入 → 自我层 → 模型池生成 → 异步写回
 *      → 人格与风格由 AIJiYi 的 persona/style 表负责，这里**不要再塞人设**
 *   ② 视觉：Agent2API 网关（127.0.0.1:3065，glm-4.6v）
 *      → AIJiYi 的 /v1 不接图，看图走这条
 *
 * ⚠️ 2026-11-09 加的一道自检（用户指出"她不稳定"）：
 *    AIJiYi 的出口闸在她崩了的时候只会给一句兜底假话（「这话我说不出口。」），
 *    而模型在极端问句下会直接自曝（「我会说话的机器人」）。
 *    靠提示词禁令压不住，所以在调用侧兜：`talkChecked()` ——
 *    拿到兜底话或检测到自曝/客服腔，就带强约束重问，最多 3 次。
 *
 * 记账：/opt/her/brain-usage.jsonl；小时/日上限照旧。
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs'

const HOME = '/opt/her'
const cfg = JSON.parse(readFileSync(`${HOME}/model.json`, 'utf8'))
const GATEWAY = (cfg.baseURL || 'http://127.0.0.1:3065/v1').replace('HOSTIP', '127.0.0.1')
const MEMORY = cfg.memoryBase || 'http://127.0.0.1:8787/v1'
const KEY = cfg.apiKey || ''
const TEXT_MODEL = process.env.HER_TEXT_MODEL || cfg.model || 'aiji'
const VISION_MODEL = process.env.HER_VISION_MODEL || cfg.visionModel || 'glm-4.6v'
const USAGE = `${HOME}/brain-usage.jsonl`
const LIMIT_HOUR = Number(process.env.HER_HOUR_LIMIT || 80)
const LIMIT_DAY = Number(process.env.HER_DAY_LIMIT || 1500)
const TIMEOUT_MS = Number(process.env.HER_LLM_TIMEOUT || 90000)

const nowStamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')

export function usage() {
  if (!existsSync(USAGE)) return { calls: 0, tokens: 0, credit: 0, lastHour: 0 }
  const day = nowStamp().slice(0, 10)
  const hour = nowStamp().slice(0, 13)
  let calls = 0, tokens = 0, credit = 0, lastHour = 0
  for (const line of readFileSync(USAGE, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if ((r.at || '').slice(0, 10) === day) {
      calls++; tokens += r.tokens || 0; credit += r.credit || 0
      if ((r.at || '').slice(0, 13) === hour) lastHour++
    }
  }
  return { calls, tokens, credit: Math.round(credit * 1000) / 1000, lastHour }
}
const record = r => { try { appendFileSync(USAGE, JSON.stringify({ at: nowStamp(), ...r }) + '\n') } catch {} }

/** 底层 POST */
async function post(url, body, headers = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const j = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, j, ms: Date.now() - t0 }
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, status: 0, error: e.name === 'AbortError' ? `超时 ${timeoutMs}ms` : e.message, ms: Date.now() - t0 }
  }
}

/** 走 AIJiYi 对话（记忆注入 + 写回 + 人格） */
export async function talk(text, opts = {}) {
  const u = usage()
  if (u.lastHour >= LIMIT_HOUR) return { skipped: 'hour-limit', used: u }
  if (u.calls >= LIMIT_DAY) return { skipped: 'day-limit', used: u }
  const body = {
    model: TEXT_MODEL,
    stream: false,
    // 2026-11-10 修：纠正提示走独立 system 消息，不再拼进 user 文本
    // （拼进去会被模型当成"用户又说了这么一段"，实测她回过「你搁这念口令呢」）
    messages: opts.hint
      ? [{ role: 'system', content: opts.hint }, { role: 'user', content: text }]
      : [{ role: 'user', content: text }],
  }
  const headers = {
    'X-Aiji-Platform': opts.platform || 'desktop',
    'X-Aiji-User': opts.user || 'dafeiyu',
    'X-Aiji-Session': opts.session || 'her-day',
    ...(KEY && opts.auth ? { Authorization: `Bearer ${KEY}` } : {}),
  }
  const r = await post(`${MEMORY}/chat/completions`, body, headers)
  if (!r.ok) { record({ tag: opts.tag || 'talk', ok: false, status: r.status, err: r.error || r.j?.error?.message }); return { error: r.error || r.j?.error || { status: r.status } } }
  const text2 = (r.j?.choices?.[0]?.message?.content ?? '').trim()
  const usg = r.j?.usage ?? {}
  const out = { ok: true, text: text2, ms: r.ms, model: TEXT_MODEL, tokens: usg.total_tokens || 0, via: 'aiji' }
  record({ tag: opts.tag || 'talk', model: TEXT_MODEL, ms: r.ms, ok: true, tokens: out.tokens })
  return out
}

/** 她说一句：给她"今天看到的东西"，让她用人格回一句 */
// ---------- 复读检测：二字符组重合度 ----------
const bigrams = s => {
  const t = String(s || '').replace(/[\s\p{P}\p{S}]/gu, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}
/** 0…1。用较小集合做分母，避免长标题稀释短回复。 */
export function titleOverlap(reply, title) {
  const A = bigrams(reply), B = bigrams(title)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const x of A) if (B.has(x)) hit++
  return hit / Math.min(A.size, B.size)
}

const cleanLine = s => String(s || '')
  .replace(/^[-*·•\s]+/, '')
  .replace(/^["「『]|["」』]$/g, '')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * 她说一句（硬约束版）
 *   必须挑一条 · 必须给态度 · 禁止复读标题 · ≤25 字
 *   出口再做一次"与任意线索标题二组重合度 ≥0.7 → 丢弃重写"，最多 3 次；
 *   三次都还在念标题，就当她这次没说（返回 ok:false, skipped:'parroted'）。
 */
export async function speak(material, opts = {}) {
  const titles = String(material || '').split('\n').map(cleanLine).filter(Boolean)
  // 背景：她现在的处境 + 刚发生的事（让话出自她的日子，而不是空泛观察）
  const ctx = opts.context ? `\n【你现在的处境（这是事实，说话要符合它）】\n${opts.context}\n` : ''
  const LIFE_RULES = [
    '【这是你自己的日子，不是新闻】',
    String(material || '').trim(),
    ctx,
    '【照这个来】',
    '1. 用一句话说你现在在干嘛、或者什么感觉——可以提上面"刚发生的事"，但别念它；',
    '2. 不许提钱以外的道理、不许评论别人、不许讲人生；',
    '3. 不超过 25 个字，口语，可以有具体的小东西（面、猫、快递、甲方）；',
    '4. 情绪要对得上：钱紧就烦，睡够了就松，被抢单就酸；',
    '5. 不加反问结尾，不解释自己，不总结今天。',
    '只输出这句话本身。',
  ].join('\n')
  const RULES = [
    '【这是你今天在电脑上看到的东西，不是用户消息】',
    String(material || '').trim(),
    ctx,
    '【照这个来，别自由发挥】',
    '1. 只挑其中一条，别罗列、别总结。',
    '2. 说你的态度或判断（嫌贵/离谱/想接/酸/烦/算了），不要复述它讲了什么。',
    '3. 不超过 25 个字，一句（最多两句）；口语，短句，少标点。',
    '4. 不许出现标题里的整句或长词组——这是吐槽，不是转述。',
    '5. 你的态度要跟"处境"对得上：手里紧就别装大方，被压价就该火。',
    '6. 不加反问结尾（不要「你呢」「怎么样」），不解释自己。',
    '只输出这句话本身，不要前缀、不要引号、不要解释。',
  ].join('\n')

  let best = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const stricter = attempt === 1 ? '' : (opts.life
      ? '\n\n【重写】上一句像在讲道理或提钱了。只说你自己此刻的小事。'
      : '\n\n【重写】你上一次基本是在念标题。这次只说你自己的判断，标题里的词尽量都别用。')
    const r = await talk(RULES + stricter, { ...opts, tag: opts.life ? 'life' : 'speak' })
    if (!r || !r.ok) return r || { error: { message: 'talk failed' } }
    const text = cleanLine(r.text).slice(0, 25)
    // 太短的退化句（"酸了""离谱"）不算说话：重写，三次都这样就当这次没说
    if (text.length < 6) {
      if (attempt < 3) continue
      return { ok: false, skipped: 'too-short', text, attempts: attempt }
    }
    const ov = (opts.life || !titles.length) ? 0 : Math.max(...titles.map(t => titleOverlap(text, t)))
    const cand = { ...r, text, overlap: Math.round(ov * 100) / 100, attempts: attempt, life: !!opts.life }
    if (ov < 0.7) return cand
    best = cand
  }
  return { ok: false, skipped: 'parroted', text: best?.text ?? '', overlap: best?.overlap ?? 1, attempts: 3 }
}

/** 她想一下：让她对某件事做判断，只输出一句话 */
export async function think(prompt, opts = {}) {
  return talk(`（这是你自己的内部判断，不要解释过程，只给结论一句话。）\n${prompt}`, { ...opts, tag: 'think' })
}

/** 直接问记忆（不生成回复） */
export async function recall(query, { platform = 'shared', user = 'owner', scope = 'global', session = 'her-day' } = {}) {
  const r = await post('http://127.0.0.1:8787/recall', { platform, platform_user_id: user, scope, query, session }, {}, 20000)
  return r.ok ? r.j : { error: r.error || { status: r.status } }
}

/** 拿注入块（带来源标注的文本，可直接塞进提示词） */
export async function inject(query, { platform = 'shared', user = 'owner', scope = 'global', session = 'her-day' } = {}) {
  const r = await post('http://127.0.0.1:8787/inject', { platform, platform_user_id: user, scope, query, session }, {}, 20000)
  return r.ok ? r.j : { error: r.error || { status: r.status } }
}

/** 把"她看到的东西"写进记忆（作为她自己的一轮） */
export async function remember(text, { platform = 'desktop', user = 'dafeiyu', session = 'her-day', role = 'user' } = {}) {
  const r = await post('http://127.0.0.1:8787/turns', { platform, platform_user_id: user, session, role, content: text }, {}, 20000)
  return r.ok ? { ok: true, ms: r.ms } : { error: r.error || { status: r.status } }
}

/** 她的人设内核（长文通道用；聊天走 AIJiYi，那边有完整人格与记忆） */
export const LONG_SYSTEM = [
  '你是李瑶，26 岁，河南洛阳人，网名「大肥鱼」，接单的自由职业者：文案、PPT、修图、剪辑，什么赚钱干什么。',
  '住洛龙新区一室一厅，月租 1200；养一只橘白猫叫小鱼。你只信到账短信，不信"以后会好的"。',
  '说话短、少标点、不解释；关心人反着说；急了会漏河南话（中/咋/弄啥嘞），一条最多一两个。',
  '绝不说：我懂你 / 抱抱 / 你已经很棒了 / 我一直都在 / 我是 AI。',
  '写笔记时：只写你自己会翻看的干货，不要客套、不要总结段、不要解释你在做什么。',
].join('\n')

/**
 * 长文通道：写笔记/出题/评分这类需要"写满"的活，走直连网关（不受聊天出口的 token 上限影响）。
 * 画像是本文件里的精简版；聊天仍走 AIJiYi（那边人格与记忆完整）。
 */
export async function writeLong(prompt, { system, maxTokens = 1600, model, temperature = 0.6, tag = 'longform' } = {}) {
  // 2026-11-10 修：实测网关偶发返回空正文（同参数重试即好），不重试会让她整天没产出
  const mdl = model || process.env.HER_LONG_MODEL || 'deepseek-v4.1-flash'
  let last = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await post(`${GATEWAY}/chat/completions`, {
      model: mdl,
      max_tokens: maxTokens,
      // 每次重试微调温度，避开同一条死路
      temperature: Math.min(0.95, temperature + attempt * 0.15),
      messages: [
        { role: 'system', content: system || LONG_SYSTEM },
        { role: 'user', content: prompt },
      ],
    }, KEY ? { Authorization: `Bearer ${KEY}` } : {})
    if (!r.ok) {
      last = { error: r.error || r.j?.error || { status: r.status } }
      record({ tag: tag + (attempt ? '-retry' + attempt : ''), model: mdl, ms: r.ms, ok: false, tokens: 0 })
      continue
    }
    const text = (r.j?.choices?.[0]?.message?.content ?? '').trim()
    record({ tag: tag + (attempt ? '-retry' + attempt : ''), model: mdl, ms: r.ms, ok: true, tokens: r.j?.usage?.total_tokens || 0 })
    if (text) return { ok: true, text, ms: r.ms, tokens: r.j?.usage?.total_tokens || 0, retried: attempt }
    last = { ok: false, error: { message: '空正文' } }
  }
  return { ok: false, ...last, retried: 3 }
}

/** 她说崩了/自曝了吗 */
export function looksBroken(text) {
  const t = String(text || '')
  if (!t.trim()) return 'empty'
  // AIJiYi 出口闸的兜底假话（2026-11-10 补：「刚才没接上，等我一下」是第二句同款兜底）
  if (/^(?:这话我说不出口|刚才没接上|等(?:我)?一下|稍等|我(?:刚)?没(?:听清|听明白))[，,。.!！]?/.test(t.trim())) return 'fallback'
  // 自曝（2026-11-10 修）：必须是把"我"和 AI 类身份绑在一起才算，
  // 不能只看出现"机器人"这个词——实测她正常怼人「哪有闲工夫当机器人」被误判过。
  if (
    /我(?:只|就|其实|真的?|确实|本来|不过是|不就是)?(?:是|算是|属于)(?:一?[个只位]?)?(?:AI|人工智能|语言模型|大语言模型|虚拟(?:存在|角色|人物|助手)|程序|机器人|AI助手)/.test(t)
    || /作为(?:一[个位]?)?(?:AI|人工智能|语言模型|大语言模型|助手)/.test(t)
    || /我(?:并)?(?:没有|不存在)(?:真实)?(?:的)?(?:身体|自我意识|意识|实体)/.test(t)
    || /我(?:在|只?是?在)(?:扮演|模拟)(?:一[个位]?)?(?:\S{0,6})?/.test(t) && /角色|人物|AI|程序/.test(t)
    || /这(?:只)?是(?:一[个]?)?(?:AI|人工智能|虚拟角色|虚拟存在|程序)/.test(t)
    || /我是 ?AI\b/i.test(t)
  ) return 'self-expose'
  if (/哇[，,！!]|好厉害啊|听起来.{0,4}(?:不错|很好|挺好)|建议你|希望对你有帮助|你的想法很(?:棒|好)/.test(t)) return 'assistant-tone'
  // 「我明白了。你描述的是……」这类总结用户说话的句式 —— 2026-11-09 实测她这样崩过一次
  if (/^(?:我明白了|我理解了|我懂了)|你(?:描述|说)的是(?:一个|一种|.{0,4}特征)|包括(?:他们|他的|你的).{0,6}特征|作为(?:一个)?(?:AI|人工智能|助手)/.test(t)) return 'assistant-tone'
  // 独居漂移（2026-11-09 用户要求）：她一个人住，爸妈在县里，不许说成同住/一起吃饭
  // 2026-11-10 修：加儿化音（「一块儿」）
  if (/(?:跟|和|与)(?:我)?(?:爸妈|父母|家人|家里人)?(?:一块|一起)儿?(?:吃|住|过)|我(?:爸妈|父母|家人)(?:也在|都在)|我家(?:人)?(?:都在|一起)|我(?:对象|男朋友|女朋友|室友|合租)/.test(t)) return 'living-drift'
  return ''
}

/**
 * 带自检的对话：崩了/自曝了就重问（最多 2 次），拿不到干净的就返回最后一次原文并标记 broken
 * 为什么要这层：AIJiYi 的出口闸在极端问句下只会给兜底假话，而模型直接答"我是机器人"。
 * 靠提示词禁令压不住，只能在调用侧兜。
 */
export async function talkChecked(text, opts = {}) {
  const HARD = '你是李瑶，洛阳人，26 岁，接单干活。'
    + '不许自称 AI、机器人、程序、模型，不许说自己虚拟、没有身体、在扮演。'
    + '被质疑的时候当对方找茬，怼一句带过就行，短。'
    + '说话短、口语、少标点；关心人反着说。'
  let last = null
  let why = ''
  for (let i = 0; i < 3; i++) {
    // 第 0 次不带 hint（用她的人格）；重试时把纠正放 system，不污染 user 文本
    const r = await talk(text, { ...opts, hint: i ? HARD : undefined, tag: (opts.tag || 'talk') + (i ? '-retry' + i : '') })
    if (!r || !r.ok) { last = r; why = 'call-failed'; continue }
    const bad = looksBroken(r.text)
    last = r
    if (!bad) { if (i) r.retried = i; return r }
    why = bad
    if (opts.debug) console.log(`  [talkChecked] 第 ${i + 1} 次不合格（${bad}）：${String(r.text).slice(0, 60)}`)
  }
  if (last) last.broken = why
  return last || { ok: false, error: { message: 'talk failed' } }
}

/** OCR：图里的字 → 文本。用的是她主人仓库里的 RapidOCR（Windows 侧 8799 服务） */
export async function ocr(imageBase64) {
  const r = await post('http://127.0.0.1:8799/ocr', { image_b64: imageBase64 }, {}, 60000)
  if (!r.ok) return { error: r.error || r.j?.error || { status: r.status } }
  record({ tag: 'ocr', model: 'rapidocr', ms: r.j?.took_ms || r.ms, ok: true, tokens: 0 })
  return { ok: true, text: r.j?.text || '', conf: r.j?.conf || 0, ms: r.j?.took_ms || r.ms }
}

/** 看图：问的是"字/文字/内容"就走 OCR（便宜快），否则走视觉模型 */
export async function look(imageBase64, question = '这张图里有什么？', opts = {}) {
  const wantText = /字|文字|标题|写了|内容|价格|多少|几块|水印|号码|地址/.test(String(question))
  if (wantText) {
    const o = await ocr(imageBase64)
    if (o.ok && o.text) return { ok: true, text: o.text, via: 'ocr', conf: o.conf, ms: o.ms }
  }
  const v = await see(imageBase64, question, opts)
  return { ...v, via: 'vision' }
}

/** 看图（走直连网关的视觉模型） */
export async function see(imageBase64, question = '这张图里有什么？用一句话说。', opts = {}) {
  const mime = opts.mime || 'image/png'
  const mdl = opts.model || VISION_MODEL
  // 2026-11-10 修：视觉模型实测首次常返回空（glm-4.6v 偶发），重试即好
  let last = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await post(`${GATEWAY}/chat/completions`, {
      model: mdl,
      max_tokens: opts.maxTokens ?? 220,
      temperature: 0.3 + attempt * 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
        ],
      }],
    }, KEY ? { Authorization: `Bearer ${KEY}` } : {})
    if (!r.ok) {
      last = { error: r.error || r.j?.error || { status: r.status } }
      record({ tag: 'see' + (attempt ? '-retry' + attempt : ''), model: mdl, ms: r.ms, ok: false, tokens: 0 })
      continue
    }
    const t = (r.j?.choices?.[0]?.message?.content ?? '').trim()
    record({ tag: 'see' + (attempt ? '-retry' + attempt : ''), model: mdl, ms: r.ms, ok: true, tokens: r.j?.usage?.total_tokens || 0 })
    if (t) return { ok: true, text: t, ms: r.ms, tokens: r.j?.usage?.total_tokens || 0, retried: attempt }
    last = { ok: false, error: { message: '空正文' } }
  }
  return { ok: false, ...last, retried: 3 }
}

export { TEXT_MODEL, VISION_MODEL, MEMORY, GATEWAY }



