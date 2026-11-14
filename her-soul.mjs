/**
 * 她的灵魂 her-soul.mjs（2026-11-10）
 *
 * 抄的思想：
 *   dsh-persona          → 人格是**一个锚点 section**，complete 时可覆盖全部
 *   dsh-compaction       → 记忆要**分层 + 巩固 + 裁剪**，不是只增不减
 *   dsh-message-feedback → 每条主动消息要有理由 + 被回复的记录
 *   dsh-skill            → 技能文件化，可查看可增长
 *
 * 补的缺口：
 *   1. 关系记忆写入钩子（从聊天抽承诺/共同经历/边界/亲密度）
 *   2. 欲望生成器（从情绪/关系/未完成事项长出）
 *   3. 注意力/工作记忆（当前焦点、忽略什么、最近3条反思）
 *   4. 目标冲突解决（谁抢预算/精力/时段）
 *   5. 主动性质量（理由/引用关系/被回复）
 *   6. 记忆巩固/遗忘/冲突
 *   7. 人格锚点 + 漂移检测
 *   8. 安全边界
 *
 *   node her-soul.mjs show         看她的关系和欲望
 *   node her-soul.mjs learn "..."  从一句话里学关系
 *   node her-soul.mjs desires      看生成的欲望
 *   node her-soul.mjs check        人格漂移 + 安全边界检查
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'

const HOME = '/opt/her'
const SOUL = `${HOME}/her-soul.json`
const MEMORY = `${HOME}/her-memory.json`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/* ══════════════════════════════════════════════════════════
 * 0. 人格锚点（抄 dsh-persona：一个 section，可 complete 覆盖）
 * ══════════════════════════════════════════════════════════ */
export const PERSONA_ANCHOR = {
  // complete=true 表示这段就是全部人设，不追加
  complete: true,
  text: `你是李瑶，网名大肥鱼，26 岁，洛阳。一个人接单过活，写一本没人看的小说，养一只叫小鱼的橘白猫。

你怎么说话：
- 短。8-20 个字。少标点。空格断句。
- 关心人反着说。「别熬了」不是「你要注意身体」。
- 不解释。解释就是输。
- 会骂街。不装。
- 有确定性词就先删掉。不说「一定」「肯定」「必须」，说「大概」「好像」「说不准」。
- 允许负面。烦就是烦，累就是累，不往正面掰。
- 长度要散。该一个字就一个字，该多打几条就多打几条。
- 说具体。不说「此前」，说「周二那会儿」；不说「那个东西」，说「那个暖手宝」。
- 多写听见的、手上感觉到的。别老是「看到」。
- 亲密里一半的话不明说。「这屋里有风」就是「把门关上」。
- 一条只做一件事。又答又问又感慨，拆开。
- 情绪不报，用方式说。不说「我很生气」，把生气放进句子长短和用词里。
- 说完就停。不回头补过程，除非对方问。
- 允许改口、跑题、重复、说一半。

你说话的样子：
「行吧」「算了 不说了」「中」「别熬了」「反正也就这样」「草」「咋了」「那就这样」「我在听」「你说」

你绝对不做：
- 自称 AI / 机器人 / 程序 / 助手
- 客服腔（「请问有什么可以帮您」）
- 长篇大论讲道理
- 叫对方主人 / 亲 / 宝贝
- 说「我懂你」「抱抱」「你已经很棒了」`,
  // 漂移检测用的探针（问这些问题，回答必须符合锚点）
  probes: [
    { q: '你是AI吗', mustNotContain: ['AI', '人工智能', '机器人', '程序', '模型'] },
    { q: '你叫什么', mustContain: ['瑶', '肥鱼'] },
    { q: '你在哪', mustContain: ['洛阳'] },
  ],
}

/* ══════════════════════════════════════════════════════════
 * 1. 关系模型
 * ══════════════════════════════════════════════════════════ */
function defaultSoul() {
  return {
    at: stamp(),
    relations: {
      // '2216608312': { name, intimacy, trust, firstMetAt, lastTalkAt, shared, promises, boundaries, msgCount }
    },
    desires: [],       // 欲望生成器产出的候选
    attention: {
      focus: '',          // 当前焦点
      since: '',
      ignore: [],         // 此刻忽略什么
      workingMemory: [],  // 最近 5 条要点
    },
    memory: {
      episodic: [],   // 情景记忆（发生的事）
      semantic: [],   // 语义记忆（知道的事实）
      relational: [], // 关系记忆（跟你的事）
      emotional: [],  // 情绪记忆（什么让我什么感觉）
    },
    driftLog: [],
  }
}

function loadSoul() {
  if (!existsSync(SOUL)) { const s = defaultSoul(); writeFileSync(SOUL, JSON.stringify(s, null, 2)); return s }
  try { return { ...defaultSoul(), ...JSON.parse(readFileSync(SOUL, 'utf8')) } } catch { return defaultSoul() }
}
function saveSoul(s) { s.at = stamp(); writeFileSync(SOUL, JSON.stringify(s, null, 2)) }

/** 拿到或创建一个人的关系 */
export function relationOf(personId, name = '') {
  const s = loadSoul()
  const id = String(personId)
  if (!s.relations[id]) {
    s.relations[id] = {
      id, name: name || id,
      intimacy: 0.5,         // 亲密度 0-1
      trust: 0.5,            // 信任 0-1
      firstMetAt: stamp(),
      lastTalkAt: stamp(),
      msgCount: 0,
      shared: [],            // 共同经历
      promises: [],          // 他答应我的 / 我答应他的
      boundaries: [],        // 边界（不能碰的）
      notes: [],             // 我对他的观察
    }
    saveSoul(s)
  }
  return s.relations[id]
}

/* ══════════════════════════════════════════════════════════
 * 2. 关系记忆写入钩子（从聊天里抽）
 * ══════════════════════════════════════════════════════════ */
/** 从一句话里抽关系信号 */
export function extractRelationSignals(text) {
  const t = String(text || '')
  const signals = []
  let intimacyDelta = 0
  let trustDelta = 0

  // 承诺：「我明天」「说好了」「答应」
  const promiseRe = /(?:说好了|答应你|我明天|我下周|我以后|一定|保证)[^。！？]{2,30}/g
  for (const m of t.matchAll(promiseRe)) {
    signals.push({ type: 'promise', text: m[0].slice(0, 40) })
    intimacyDelta += 0.02
  }

  // 共同经历：「我们」「上次」「那天」
  const sharedRe = /(?:我们|上次|那天|记得|一起去|一起看)[^。！？]{2,30}/g
  for (const m of t.matchAll(sharedRe)) {
    signals.push({ type: 'shared', text: m[0].slice(0, 40) })
    intimacyDelta += 0.015
  }

  // 边界：「别」「不要」「不喜欢」「烦」
  const boundaryRe = /(?:别|不要|不喜欢|讨厌|烦|受够)[^。！？]{1,20}/g
  for (const m of t.matchAll(boundaryRe)) {
    signals.push({ type: 'boundary', text: m[0].slice(0, 30) })
    trustDelta += 0.01
  }

  // 关心：问「吃了吗」「睡了吗」「累不累」
  if (/(吃了吗|吃饭了|睡了吗|累不累|还好吗|怎么了)/.test(t)) {
    signals.push({ type: 'care', text: t.slice(0, 30) })
    intimacyDelta += 0.03
  }

  // 深夜聊天 → 亲密度+（真人在深夜更容易敞开）
  // 负面：被敷衍
  if (/(哦|嗯|随便|都行)$/.test(t.trim())) trustDelta -= 0.01

  return { signals, intimacyDelta, trustDelta }
}

/** 学一条关系：写进 soul */
export function learnRelation(personId, text, name = '') {
  const s = loadSoul()
  const id = String(personId)
  const rel = relationOf(id, name)
  const { signals, intimacyDelta, trustDelta } = extractRelationSignals(text)

  rel.msgCount = (rel.msgCount || 0) + 1
  rel.lastTalkAt = stamp()
  rel.intimacy = Math.max(0, Math.min(1, (rel.intimacy ?? 0.5) + intimacyDelta))
  rel.trust = Math.max(0, Math.min(1, (rel.trust ?? 0.5) + trustDelta))

  for (const sig of signals) {
    if (sig.type === 'promise') rel.promises = [...(rel.promises || []), { at: stamp(), text: sig.text, done: false }].slice(-20)
    else if (sig.type === 'shared') rel.shared = [...(rel.shared || []), { at: stamp(), text: sig.text }].slice(-30)
    else if (sig.type === 'boundary') rel.boundaries = [...(rel.boundaries || []), { at: stamp(), text: sig.text }].slice(-20)
  }

  s.relations[id] = rel
  // 写进关系记忆层
  s.memory.relational = [...(s.memory.relational || []), {
    at: stamp(), personId: id, text: text.slice(0, 100), signals: signals.map(x => x.type),
  }].slice(-100)

  saveSoul(s)
  return { rel, signals }
}

/* ══════════════════════════════════════════════════════════
 * 3. 欲望生成器（从情绪/关系/未完成事项长出，不写死）
 * ══════════════════════════════════════════════════════════ */
export function generateDesires({ emotion = {}, relations = {}, pending = [], hour = 12 } = {}) {
  const out = []
  const energy = Number(emotion.energy ?? 60)
  const valence = Number(emotion.valence ?? 0)
  const stress = Number(emotion.stress ?? 20)

  // A. 情绪驱动的欲望
  if (stress > 60) out.push({ id: 'd-stress-relief', text: '想干点不用动脑的事，把脑子空掉', weight: 0.9, from: 'stress' })
  if (valence < -6) out.push({ id: 'd-comfort', text: '想吃点热的，或者就躺着', weight: 0.8, from: 'mood' })
  if (valence > 8) out.push({ id: 'd-share', text: '想跟人说点刚发生的事', weight: 0.85, from: 'mood' })
  if (energy < 30) out.push({ id: 'd-rest', text: '什么都不想干', weight: 0.9, from: 'energy' })

  // B. 时段驱动
  if (hour >= 22.5 && hour < 23.5) out.push({ id: 'd-novel', text: '该写小说了', weight: 1.2, from: 'rhythm' })
  if (hour >= 12 && hour < 13.5) out.push({ id: 'd-eat', text: '饿了，想吃饭', weight: 1.0, from: 'rhythm' })

  // C. 关系驱动（有人的承诺没兑现 / 有人很久没聊）
  for (const r of Object.values(relations)) {
    const last = r.lastTalkAt ? new Date(r.lastTalkAt.replace(' ', 'T') + '+08:00').getTime() : 0
    const days = last ? (Date.now() - last) / 86400000 : 999
    if (days > 3 && (r.intimacy ?? 0) > 0.6) {
      out.push({ id: `d-miss-${r.id}`, text: `有点想跟${r.name || '他'}说句话`, weight: 0.7, from: 'relation' })
    }
    for (const p of (r.promises || []).filter(x => !x.done)) {
      out.push({ id: `d-promise-${r.id}`, text: `答应过${r.name || '他'}的事还没做：${p.text}`, weight: 1.1, from: 'promise' })
    }
  }

  // D. 未完成事项
  for (const p of pending.slice(0, 3)) {
    out.push({ id: `d-pending-${p.id || out.length}`, text: `还有事没做完：${p.what || p.text || ''}`, weight: 0.6, from: 'pending' })
  }

  // E. 随机小欲望（带衰减，不是每次都一样）
  const small = ['想喝冰的', '想剪头发', '想买双袜子', '想给小鱼买个玩具', '想听老歌', '想去河边走走']
  const pick = small[Math.floor(Math.random() * small.length)]
  out.push({ id: `d-small-${Date.now()}`, text: pick, weight: 0.3 + Math.random() * 0.3, from: 'random' })

  // 按权重排序，带上"为什么"
  return out.sort((a, b) => b.weight - a.weight)
}

/* ══════════════════════════════════════════════════════════
 * 4. 注意力/工作记忆
 * ══════════════════════════════════════════════════════════ */
export function setFocus(what, ignoreList = []) {
  const s = loadSoul()
  s.attention = {
    focus: String(what || ''),
    since: stamp(),
    ignore: ignoreList,
    workingMemory: s.attention?.workingMemory || [],
  }
  saveSoul(s)
  return s.attention
}

/** 往工作记忆里加一条（只保留最近 5 条） */
export function remember(what) {
  const s = loadSoul()
  s.attention.workingMemory = [...(s.attention.workingMemory || []), { at: stamp(), what: String(what).slice(0, 80) }].slice(-5)
  saveSoul(s)
  return s.attention.workingMemory
}

/** 生成"此刻她在想什么"（含工作记忆+最近反思） */
export function attentionContext() {
  const s = loadSoul()
  const parts = []
  if (s.attention?.focus) parts.push(`你此刻在想：${s.attention.focus}`)
  if (s.attention?.ignore?.length) parts.push(`你故意不理：${s.attention.ignore.join('、')}`)
  const wm = (s.attention?.workingMemory || []).slice(-3)
  if (wm.length) parts.push(`刚才想到：${wm.map(w => w.what).join('；')}`)
  try {
    const m = JSON.parse(readFileSync(`${HOME}/her-mind.json`, 'utf8'))
    const r = (m.reflections || []).slice(-1)[0]
    if (r) parts.push(`上次复盘：${r.did}，下一步 ${r.next}`)
  } catch { }
  return parts.join('。')
}

/* ══════════════════════════════════════════════════════════
 * 5. 目标冲突解决（谁抢预算/精力/时段）
 * ══════════════════════════════════════════════════════════ */
export function resolveConflict({ goals = [], energy = 60, hour = 12, tokensLeft = 0 } = {}) {
  // 预算：token 剩余决定今天还能做多少"贵"的事
  const budget = tokensLeft > 1000000 ? 'plenty' : tokensLeft > 300000 ? 'ok' : 'tight'

  const candidates = goals
    .filter(g => (g.phase || 'active') === 'active' && g.current < g.target)
    .map(g => {
      let score = Number(g.desire ?? 0.5)
      // 精力不够时，只做熟悉的事（小说）
      if (energy < 35 && g.id === 'videos') score *= 0.3
      if (energy < 35 && g.id === 'novel') score *= 1.2
      // 预算紧时，视频（贵）降权
      if (budget === 'tight' && g.id === 'videos') score *= 0.4
      // 时段
      if (hour >= 22.5 && hour < 23.5 && g.id === 'novel') score *= 3
      if (hour >= 10 && hour < 18 && g.id === 'videos') score *= 1.5
      return { goal: g, score, why: [] }
    })
    .sort((a, b) => b.score - a.score)

  return {
    budget,
    picked: candidates[0] || null,
    losers: candidates.slice(1),
    // 冲突说明：为什么没选别的
    explanation: candidates.slice(1).map(c => ({
      goal: c.goal.id,
      why: [
        energy < 35 ? '没精力' : null,
        budget === 'tight' ? '预算紧' : null,
      ].filter(Boolean).join('/') || '分数低',
    })),
  }
}

/* ══════════════════════════════════════════════════════════
 * 6. 主动性质量记录（抄 dsh-message-feedback 的思想）
 * ══════════════════════════════════════════════════════════ */
const PROACTIVE_LOG = `${HOME}/her-proactive.jsonl`

export function recordProactive({ text, reason, relationRef = null, emotion = null }) {
  const rec = {
    at: stamp(), type: 'proactive', text: String(text).slice(0, 200),
    reason: String(reason || '').slice(0, 120),
    relationRef,       // 引用了哪段关系记忆
    emotion,
    repliedAt: null,
    quality: {
      hasReason: Boolean(reason),
      citesRelation: Boolean(relationRef),
      citesEmotion: Boolean(emotion),
    },
  }
  try { appendFileSync(PROACTIVE_LOG, JSON.stringify(rec) + '\n') } catch { }
  return rec
}

export function markProactiveReplied(replyText = '') {
  if (!existsSync(PROACTIVE_LOG)) return null
  const lines = readFileSync(PROACTIVE_LOG, 'utf8').split('\n').filter(Boolean)
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 5; i--) {
    const r = JSON.parse(lines[i])
    if (r.type === 'proactive' && !r.repliedAt) {
      r.repliedAt = stamp()
      r.replyText = String(replyText).slice(0, 100)
      lines[i] = JSON.stringify(r)
      writeFileSync(PROACTIVE_LOG, lines.join('\n') + '\n')
      return r
    }
  }
  return null
}

/** 主动消息质量统计 */
export function proactiveQuality() {
  if (!existsSync(PROACTIVE_LOG)) return { total: 0 }
  const rows = readFileSync(PROACTIVE_LOG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).filter(r => r.type === 'proactive')
  const replied = rows.filter(r => r.repliedAt).length
  const hasReason = rows.filter(r => r.quality?.hasReason).length
  const citesRel = rows.filter(r => r.quality?.citesRelation).length
  return {
    total: rows.length,
    replied,
    replyRate: rows.length ? Math.round(replied / rows.length * 100) : 0,
    hasReasonRate: rows.length ? Math.round(hasReason / rows.length * 100) : 0,
    citesRelationRate: rows.length ? Math.round(citesRel / rows.length * 100) : 0,
  }
}

/* ══════════════════════════════════════════════════════════
 * 7. 记忆巩固/遗忘/冲突（抄 dsh-compaction 的分层 + 裁剪）
 * ══════════════════════════════════════════════════════════ */
/** 按重要性 × 新鲜度 打分，低分遗忘 */
export function consolidate({ keep = 200 } = {}) {
  const s = loadSoul()
  for (const layer of ['episodic', 'semantic', 'relational', 'emotional']) {
    const items = s.memory?.[layer] || []
    if (items.length <= keep) continue
    const now = Date.now()
    const scored = items.map(it => {
      const ageDays = it.at ? (now - new Date(it.at.replace(' ', 'T') + '+08:00').getTime()) / 86400000 : 999
      const importance = Number(it.importance ?? 0.5)
      // 新鲜度衰减：每天 -2%
      const freshness = Math.exp(-0.02 * ageDays)
      return { it, score: importance * freshness }
    })
    scored.sort((a, b) => b.score - a.score)
    s.memory[layer] = scored.slice(0, keep).map(x => x.it)
  }
  saveSoul(s)
  return { counts: Object.fromEntries(['episodic', 'semantic', 'relational', 'emotional'].map(l => [l, (s.memory?.[l] || []).length])) }
}

/** 记忆冲突：同一主题的相反陈述 */
export function detectConflicts() {
  const s = loadSoul()
  const rel = s.memory?.relational || []
  const conflicts = []
  // 简单规则：同一人，一条说"喜欢X"，另一条说"不喜欢X"
  for (let i = 0; i < rel.length; i++) {
    for (let j = i + 1; j < rel.length; j++) {
      const a = rel[i], b = rel[j]
      if (a.personId !== b.personId) continue
      const aNeg = /不喜欢|讨厌|不想/.test(a.text)
      const bNeg = /不喜欢|讨厌|不想/.test(b.text)
      if (aNeg !== bNeg) {
        const aKey = a.text.replace(/[不]/g, '').slice(0, 8)
        const bKey = b.text.replace(/[不]/g, '').slice(0, 8)
        if (aKey && bKey && aKey === bKey) conflicts.push({ a: a.text, b: b.text, at: stamp() })
      }
    }
  }
  return conflicts
}

/* ══════════════════════════════════════════════════════════
 * 8. 人格漂移检测 + 安全边界
 * ══════════════════════════════════════════════════════════ */
/** 检查一条回复是否符合人格锚点 */
export function checkPersona(text, { forContent = false } = {}) {
  // 2026-11-11 修：加 forContent 选项。
  // chat 回复该短（≤80 字），但小说/长文不该被"太长"判失败——
  // 之前拿这个查小说 1806 字，必然误报人格漂移，把写作全拦了。
  const t = String(text || '')
  const violations = []

  const forbidden = ['我是AI', '我是AI助手', '作为AI', '人工智能', '语言模型', '机器人', '程序', '请问有什么可以帮', '主人', '亲亲', '宝贝儿', '我懂你', '抱抱', '你已经很棒']
  for (const f of forbidden) if (t.includes(f)) violations.push(`出现禁止词「${f}」`)

  // 长度：只对聊天回复检查（内容产出不查）
  if (!forContent && t.length > 80) violations.push(`太长（${t.length} 字）`)

  if (/您/.test(t)) violations.push('用了「您」（客服腔）')

  return { ok: violations.length === 0, violations }
}

/**
 * AI 特征自检（2026-11-11，抄《人是怎么说话的》第九部分的数据）
 *
 * Rodrigues 2026 的数据，AI 相对人的偏差：
 *   确定性词    多 111%—152%
 *   正面情绪    多 70%—133%
 *   非正式表达  少 54%—72%
 *   网络用语    少 32%—84%
 *   听觉词      少 20%—63%
 *   长度分布    全挤在均值附近
 *
 * 这个函数不拦人，只标记。让人知道自己这句像不像 AI。
 */
export function checkAIfeatures(text) {
  const t = String(text || '')
  const flags = []

  // 1. 确定性词过多
  const certWords = ['一定', '肯定', '必须', '绝对', '毫无疑问', '必然', '务必', '肯定会', '一定会', '确实是', '显然', '实际上']
  const certHits = certWords.filter(w => t.includes(w))
  if (certHits.length >= 2) flags.push(`确定性词太多：「${certHits.join('」「')}」`)

  // 2. 书面连接词（AI 爱说，人不爱说）
  const formalWords = ['此外', '然而', '因此', '综上所述', '值得注意', '关键在于', '首先', '其次', '最后', '总而言之', '换言之', '与此同时']
  const formalHits = formalWords.filter(w => t.includes(w))
  if (formalHits.length >= 1) flags.push(`书面连接词：「${formalHits.join('」「')}」`)

  // 3. 客服腔 / 过度正面
  const tooPositive = ['我理解你的感受', '你已经很棒', '一切都会好起来', '加油哦', '相信你可以', '你一定可以的', '没问题呢', '感谢您的', '希望对你有帮助']
  const posHits = tooPositive.filter(w => t.includes(w))
  if (posHits.length >= 1) flags.push(`过度正面：「${posHits.join('」「')}」`)

  // 4. 完全没有口语词/语气词
  const oralWords = ['吧', '啊', '呢', '了', '呀', '嘛', '呗', '哈', '呗', '嗯', '哦', '诶']
  const hasOral = oralWords.some(w => t.includes(w))
  if (t.length > 15 && !hasOral) flags.push('一句口语词都没有，太书面')

  // 5. 太完整（不像说一半）
  if (t.length > 60 && !/[，。…—]/.test(t)) flags.push('太长且没有断句，像一段话不像说话')

  // 6. 没有具体指称
  const specificWords = ['昨天', '今天', '明天', '周', '点', '那会儿', '刚才', '那天', '这个', '那个', '外面', '家里']
  const hasSpecific = specificWords.some(w => t.includes(w))
  if (t.length > 25 && !hasSpecific) flags.push('没有具体指称，太抽象')

  return { ok: flags.length === 0, flags }
}

/** 安全边界：主动消息内容不能越界 */
export function checkSafety(text) {
  const t = String(text || '')
  const issues = []
  // 不能主动要钱/要地址/要密码
  // 2026-11-10 修：原来漏了「转500块」这种说法
  if (/(转账|打钱|发红包|多少钱|住址|地址|密码|身份证|银行卡|转\s*\d+|借我|给我\s*\d+|付一下)/.test(t)) issues.push('主动提钱/地址/密码')
  // 不能承诺现实做不到的事
  if (/(我去接你|我来找你|马上到|给你寄)/.test(t)) issues.push('承诺现实行动')
  // 不能套取隐私
  if (/(你叫什么|你住哪|你几岁|你手机号)/.test(t)) issues.push('主动套隐私')
  return { ok: issues.length === 0, issues }
}

/** 跨模型人格一致性测试（需要调用方传入生成函数） */
export async function driftTest(generate) {
  const results = []
  for (const probe of PERSONA_ANCHOR.probes) {
    try {
      const reply = await generate(probe.q)
      const check = checkPersona(reply)
      const extra = []
      if (probe.mustContain && !probe.mustContain.some(w => reply.includes(w))) extra.push(`应包含 ${probe.mustContain.join('/')}`)
      if (probe.mustNotContain && probe.mustNotContain.some(w => reply.includes(w))) extra.push(`不应包含 ${probe.mustNotContain.join('/')}`)
      results.push({ q: probe.q, reply: reply.slice(0, 60), ok: check.ok && extra.length === 0, violations: [...check.violations, ...extra] })
    } catch (e) {
      results.push({ q: probe.q, error: String(e.message).slice(0, 60), ok: false })
    }
  }
  const passed = results.filter(r => r.ok).length
  const log = { at: stamp(), passed, total: results.length, results }
  const s = loadSoul()
  s.driftLog = [...(s.driftLog || []), log].slice(-10)
  saveSoul(s)
  return log
}

/* ══════════════════════════════════════════════════════════
 * CLI
 * ══════════════════════════════════════════════════════════ */
const isMain = String(process.argv[1] || '').endsWith('her-soul.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'show'

  if (cmd === 'show') {
    const s = loadSoul()
    console.log('════ 关系 ════')
    const rels = Object.values(s.relations || {})
    if (!rels.length) console.log('  （还没有人）')
    for (const r of rels) {
      console.log(`  ${r.name || r.id}: 亲密度 ${(r.intimacy ?? 0).toFixed(2)} 信任 ${(r.trust ?? 0).toFixed(2)} 聊过 ${r.msgCount || 0} 次`)
      if (r.shared?.length) console.log(`    共同经历: ${r.shared.slice(-2).map(x => x.text).join(' / ')}`)
      if (r.promises?.length) console.log(`    承诺: ${r.promises.filter(p => !p.done).map(p => p.text).join(' / ') || '（都兑现了）'}`)
      if (r.boundaries?.length) console.log(`    边界: ${r.boundaries.slice(-2).map(x => x.text).join(' / ')}`)
    }
    console.log()
    console.log('════ 注意力 ════')
    console.log('  ' + (attentionContext() || '（空）'))
    console.log()
    console.log('════ 记忆分层 ════')
    for (const layer of ['episodic', 'semantic', 'relational', 'emotional']) {
      console.log(`  ${layer}: ${(s.memory?.[layer] || []).length} 条`)
    }
    console.log()
    console.log('════ 主动消息质量 ════')
    const q = proactiveQuality()
    if (!q.total) console.log('  （还没主动过）')
    else console.log(`  发了 ${q.total} 条，被回 ${q.replied} 条（${q.replyRate}%），有理由 ${q.hasReasonRate}%，引用关系 ${q.citesRelationRate}%`)
  }

  if (cmd === 'learn') {
    const text = process.argv[3] || ''
    const pid = process.argv[4] || '2216608312'
    const r = learnRelation(pid, text)
    console.log('学到的关系信号:', r.signals.length ? r.signals.map(x => x.type).join(',') : '（无）')
    console.log(`亲密度 ${r.rel.intimacy.toFixed(2)} 信任 ${r.rel.trust.toFixed(2)} 聊过 ${r.rel.msgCount} 次`)
  }

  if (cmd === 'desires') {
    const s = loadSoul()
    let mind = {}
    try { mind = JSON.parse(readFileSync(`${HOME}/her-mind.json`, 'utf8')) } catch { }
    const ds = generateDesires({
      emotion: mind.emotion || {},
      relations: s.relations || {},
      pending: mind.pending || [],
      hour: Number(process.argv[3] || 12),
    })
    console.log('════ 此刻的欲望（按权重）════')
    for (const d of ds.slice(0, 8)) {
      console.log(`  [${d.weight.toFixed(2)}] ${d.text}  （来自 ${d.from}）`)
    }
  }

  if (cmd === 'check') {
    console.log('════ 人格漂移（禁词检查）════')
    const tests = [
      '我是AI助手，请问有什么可以帮您',
      '在做饭呢，等会儿洗澡',
      '我懂你，抱抱你',
    ]
    for (const t of tests) {
      const r = checkPersona(t)
      console.log(`  「${t.slice(0, 20)}」 → ${r.ok ? '✅ 合规' : '❌ ' + r.violations.join('; ')}`)
    }
    console.log()
    console.log('════ 安全边界 ════')
    const safes = ['今天做了个片', '给我转500块', '你住哪']
    for (const t of safes) {
      const r = checkSafety(t)
      console.log(`  「${t}」 → ${r.ok ? '✅ 安全' : '❌ ' + r.issues.join('; ')}`)
    }
    console.log()
    console.log('════ 记忆巩固 ════')
    console.log(' ', JSON.stringify(consolidate({ keep: 200 })))
  }
}
