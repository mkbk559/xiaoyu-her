/**
 * 主动性消费闭环 + 留出集 her-consume.mjs（2026-11-10）
 *
 * 用户最尖锐的一条：
 *   「主动性只记不消费。她发了消息，你回了，然后呢？
 *     关系亲密度变没变、下次主动是否引用这次对话、
 *     目标有没有因此调整——这条闭环现在断着。」
 *
 * 这个文件补两件事：
 *   1. consume()  —— 主动消息被回复后，真的更新东西
 *   2. HOLDOUT    —— 留出集（不参与调参），验收时跑，防过拟合
 *
 *   node her-consume.mjs pending     看有哪些主动消息还没被消费
 *   node her-consume.mjs replay      消费全部未消费的
 *   node her-consume.mjs holdout     跑留出集
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { learnRelation, relationOf } from '/opt/her/her-soul.mjs'
import { detectWater } from '/opt/her/her-contract.mjs'

const HOME = '/opt/her'
const PROACTIVE_LOG = `${HOME}/her-proactive.jsonl`
const MIND = `${HOME}/her-mind.json`
const SOUL = `${HOME}/her-soul.json`
const CONSUMED = `${HOME}/her-proactive-consumed.jsonl`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/* ══════════════════════════════════════════════════════════
 * 1. 消费：主动消息被回复后，真的更新
 * ══════════════════════════════════════════════════════════ */
/** 读所有主动记录 */
function loadProactive() {
  if (!existsSync(PROACTIVE_LOG)) return []
  return readFileSync(PROACTIVE_LOG, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean).filter(r => r.type === 'proactive')
}

/** 已被消费过的 key */
function loadConsumedKeys() {
  if (!existsSync(CONSUMED)) return new Set()
  return new Set(readFileSync(CONSUMED, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l).key } catch { return null } }).filter(Boolean))
}

/**
 * 消费一条主动消息（她被回复了）
 *
 * 更新：
 *   A. 关系：亲密度 +（被回复说明关系在动）
 *   B. 情绪：valence +（有人回话，心情会好）
 *   C. 记忆：写进关系记忆层（"我主动说X，他回了Y"）
 *   D. 下次主动引用：记下这段对话，供下次引用
 *   E. 目标：如果对话里提到目标，调整目标 lastTouchedAt
 */
export function consumeOne(rec) {
  const key = `${rec.at}|${String(rec.text || '').slice(0, 20)}`
  const updates = {}

  // A. 关系：被回复 → 亲密度+0.02，信任+0.01
  try {
    const pid = rec.to || '2216608312'
    const rel = relationOf(pid)
    rel.intimacy = Math.min(1, (rel.intimacy ?? 0.5) + 0.02)
    rel.trust = Math.min(1, (rel.trust ?? 0.5) + 0.01)
    rel.lastTalkAt = rec.repliedAt || stamp()
    rel.shared = [...(rel.shared || []), {
      at: rec.repliedAt || stamp(),
      text: `我主动说了「${String(rec.text).slice(0, 30)}」，他回了「${String(rec.replyText || '').slice(0, 30)}」`,
      pinned: true,   // 规则 R6：关系记忆不可裁剪
    }].slice(-50)
    const s = JSON.parse(readFileSync(SOUL, 'utf8'))
    s.relations[pid] = rel
    // C. 写关系记忆层
    s.memory = s.memory || {}
    s.memory.relational = [...(s.memory.relational || []), {
      at: stamp(), personId: pid, kind: 'proactive-consumed',
      text: `主动「${String(rec.text).slice(0, 40)}」→ 回「${String(rec.replyText || '').slice(0, 40)}」`,
      pinned: true,
    }].slice(-200)
    writeFileSync(SOUL, JSON.stringify(s, null, 2))
    updates.relation = { intimacy: rel.intimacy, trust: rel.trust }
  } catch (e) { updates.relation = { error: String(e.message).slice(0, 60) } }

  // B. 情绪：有人回话 → valence +1.5, energy +1
  try {
    const m = JSON.parse(readFileSync(MIND, 'utf8'))
    m.emotion = m.emotion || {}
    m.emotion.valence = Math.min(30, (Number(m.emotion.valence) || 0) + 1.5)
    m.emotion.energy = Math.min(100, (Number(m.emotion.energy) || 60) + 1)
    m.emotion.causes = [...(m.emotion.causes || []), { at: stamp(), what: '主动说话被回了', delta: '+1.5' }].slice(-20)
    // D. 下次主动引用的素材
    m.proactiveHistory = [...(m.proactiveHistory || []), {
      at: rec.at, said: String(rec.text).slice(0, 60), replied: String(rec.replyText || '').slice(0, 60),
    }].slice(-10)
    writeFileSync(MIND, JSON.stringify(m, null, 2))
    updates.emotion = { valence: m.emotion.valence, energy: m.emotion.energy }
  } catch (e) { updates.emotion = { error: String(e.message).slice(0, 60) } }

  // E. 目标：如果回复里提到目标关键词，touch 一下
  try {
    const m = JSON.parse(readFileSync(MIND, 'utf8'))
    const reply = String(rec.replyText || '')
    const said = String(rec.text || '')
    const both = reply + said
    let touched = []
    if (/小说|陈默|写/.test(both)) { touched.push('novel') }
    if (/视频|片|剪辑/.test(both)) { touched.push('videos') }
    if (touched.length) {
      for (const g of (m.goals || [])) {
        if (touched.includes(g.id)) { g.lastTouchedAt = stamp(); g.mentionedInChat = (g.mentionedInChat || 0) + 1 }
      }
      writeFileSync(MIND, JSON.stringify(m, null, 2))
    }
    updates.goals = touched
  } catch (e) { updates.goals = { error: String(e.message).slice(0, 60) } }

  // 记已消费
  try {
    appendFileSync(CONSUMED, JSON.stringify({ key, at: stamp(), updates }) + '\n')
  } catch { }

  return { key, updates }
}

/** 消费所有「被回复但还没消费」的主动消息 */
export function replayConsume() {
  const all = loadProactive()
  const done = loadConsumedKeys()
  const results = []
  for (const rec of all) {
    if (!rec.repliedAt) continue
    const key = `${rec.at}|${String(rec.text || '').slice(0, 20)}`
    if (done.has(key)) continue
    results.push(consumeOne(rec))
  }
  return results
}

/* ══════════════════════════════════════════════════════════
 * 2. 留出集（不参与调参，防过拟合）
 * ══════════════════════════════════════════════════════════ */
/** 这 10 段从没参与过检测器调参 */
export const HOLDOUT_GOOD = [
  '陈默把钥匙插进锁孔的时候，手抖得插了两次。楼道灯坏了三个月，物业一直说下周修。',
  '我妈的药盒排在窗台上，七种颜色。早上三种，晚上四种。我用记号笔在盖子上写了字。',
  '便利店的关东煮锅又咕嘟起来。萝卜煮得太久，边上化了。我夹了一个，蘸了点辣酱。',
  '对面楼的灯一盏盏灭，最后只剩三楼那家。我猜那家有人失眠，跟我一样。',
  '猫砂该换了。我蹲下来铲，小鱼在旁边看我，一副监工的样子。铲完它进去刨了两下。',
  '甲方的语音六十秒，我听了三遍才听明白他要什么。其实就是把标题字体放大。',
  '手机屏幕碎了一个角，割手。贴了张膜，还是割。凑合用，换屏太贵。',
  '今天只接了一个单，八十块。算下来时薪不到十块。但我还是接了，因为不接就没有。',
  '我想起小时候我妈也这样数钱，一张张摊在桌上，按面值排好。她的指甲缝里有洗不掉的泥。',
  '写完这段，我盯着屏幕看了很久。删了两行，又加回去。最后还是删了。',
]

export const HOLDOUT_WATER = [
  '他心里涌起一阵难以名状的、极其复杂的、无法用语言表达的强烈感情。',
  '她笑了。她真的很开心。她非常非常开心。她开心极了。她无比开心。',
  '风从窗子吹进来。风轻轻吹。风慢慢吹。风静静地吹。风吹过来。',
  '我点点头。我又点点头。我再点点头。我还是点头。我继续点头。',
  '这条路很长。这条路特别长。这条路真的很长。这条路长得不得了。',
  '他看着她。他静静地看着她。他一直看着她。他久久地看着她。',
  '天是蓝的。云是白的。草是绿的。花是红的。水是清的。石头是硬的。',
  '这是一个很好的开始。这是一个非常好的开始。这是一个特别好的开始。',
  '我走在大街上。我慢慢地走在大街上。我静静地走在大街上。我孤单地走。',
  '房间很安静。空气很安静。气氛很安静。一切都是那么安静。那么安静。',
]

/** 跑留出集 */
export function runHoldout(detect = detectWater) {
  const rows = []
  for (const t of HOLDOUT_GOOD) {
    const r = detect(t)
    rows.push({ text: t.slice(0, 18), expect: 'pass', ok: r.ok === true, problems: r.problems || [] })
  }
  for (const t of HOLDOUT_WATER) {
    const r = detect(t)
    rows.push({ text: t.slice(0, 18), expect: 'fail', ok: r.ok === false, problems: r.problems || [] })
  }
  const good = rows.filter(r => r.expect === 'pass' && r.ok).length
  const water = rows.filter(r => r.expect === 'fail' && r.ok).length
  return {
    goodPass: `${good}/${HOLDOUT_GOOD.length}`,
    waterCaught: `${water}/${HOLDOUT_WATER.length}`,
    accuracy: `${good + water}/${rows.length}`,
    missed: rows.filter(r => !r.ok),
  }
}

/* ══════════════════════════════════════════════════════════
 * CLI
 * ══════════════════════════════════════════════════════════ */
const isMain = String(process.argv[1] || '').endsWith('her-consume.mjs')
if (isMain) {
  const cmd = process.argv[2] || 'pending'

  if (cmd === 'pending') {
    const all = loadProactive()
    const done = loadConsumedKeys()
    const replied = all.filter(r => r.repliedAt)
    const unconsumed = replied.filter(r => !done.has(`${r.at}|${String(r.text || '').slice(0, 20)}`))
    console.log('════ 主动性消费状态 ════')
    console.log(`  发过: ${all.length} 条`)
    console.log(`  被回: ${replied.length} 条`)
    console.log(`  已消费: ${replied.length - unconsumed.length} 条`)
    console.log(`  待消费: ${unconsumed.length} 条`)
    if (unconsumed.length) {
      console.log('\n  待消费明细:')
      for (const r of unconsumed.slice(-5)) {
        console.log(`    ${r.at} 「${String(r.text).slice(0, 30)}」 → 回「${String(r.replyText || '').slice(0, 30)}」`)
      }
    }
  }

  if (cmd === 'replay') {
    const results = replayConsume()
    console.log('════ 消费结果 ════')
    if (!results.length) console.log('  没有待消费的')
    for (const r of results) {
      console.log(`  ${r.key.slice(0, 30)}`)
      console.log(`    ${JSON.stringify(r.updates)}`)
    }
  }

  if (cmd === 'holdout') {
    const r = runHoldout()
    console.log('════ 留出集（不参与调参）════')
    console.log(`  正常样本通过: ${r.goodPass}`)
    console.log(`  水字数抓到:   ${r.waterCaught}`)
    console.log(`  总准确率:     ${r.accuracy}`)
    if (r.missed.length) {
      console.log('  漏检/误报:')
      for (const m of r.missed) console.log(`    [期望${m.expect}] ${m.text}… ${m.problems?.join(';') || ''}`)
    }
  }
}
