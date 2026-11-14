/**
 * 记忆图（2026-11-11，抄 NVIDIA/auto-ontology 的思路）
 *
 * 问题：她的记忆是散的
 *   - her-mind.json: goals / relations / focus
 *   - her-soul.json: semantic 29 条 / relational 15 条
 *   - AIJiYi: 349 条 facts
 *   - novel/: 7 段小说
 *
 * auto-ontology 的核心思路：把散数据变成 **实体-关系图**，
 * 这样能"顺着一张图想起东西"，聊天时能自然接话。
 *
 * CLI:
 *   node her-graph.mjs build     从各数据源建图
 *   node her-graph.mjs show      看图
 *   node her-graph.mjs recall <关键词>   从关键词联想
 *   node her-graph.mjs stats     统计
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const HOME = '/opt/her'
const GRAPH = `${HOME}/her-graph.json`

const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

/** 图结构：nodes { id: {type, label, attrs} } + edges [{from, rel, to, weight, since}] */
function emptyGraph() {
  return { at: stamp(), nodes: {}, edges: [] }
}

function addNode(g, id, type, label, attrs = {}) {
  if (!id) return
  const key = String(id).slice(0, 60)
  if (!g.nodes[key]) {
    g.nodes[key] = { type, label: String(label || id).slice(0, 60), attrs }
  } else {
    // 合并属性
    g.nodes[key].attrs = { ...g.nodes[key].attrs, ...attrs }
  }
}

function addEdge(g, from, rel, to, weight = 1) {
  if (!from || !to || !rel) return
  const f = String(from).slice(0, 60)
  const t = String(to).slice(0, 60)
  const exists = g.edges.find(e => e.from === f && e.rel === rel && e.to === t)
  if (exists) {
    exists.weight = (exists.weight || 1) + weight
  } else {
    g.edges.push({ from: f, rel: String(rel).slice(0, 30), to: t, weight, since: stamp() })
  }
}

/** 从各数据源建图 */
function build(write = true) {
  const g = emptyGraph()

  // ── 1. 她自己 ──
  addNode(g, '李瑶', 'person', '李瑶（大肥鱼）', { age: 26, city: '洛阳', job: '自由职业' })
  addNode(g, '大肥鱼', 'alias', '大肥鱼')
  addEdge(g, '大肥鱼', '就是', '李瑶', 10)

  // ── 2. her-mind.json ──
  try {
    const m = JSON.parse(readFileSync(`${HOME}/her-mind.json`, 'utf8'))

    // 目标
    for (const goal of (m.goals || [])) {
      const gid = '目标:' + goal.id
      addNode(g, gid, 'goal', goal.title, { current: goal.current, target: goal.target, unit: goal.unit })
      addEdge(g, '李瑶', '追求', gid, 3)
    }
    // 已完成
    for (const goal of (m.completedGoals || [])) {
      const gid = '完成:' + goal.id
      addNode(g, gid, 'achievement', goal.title, { at: goal.completedAt })
      addEdge(g, '李瑶', '做到了', gid, 5)
    }

    // 关系
    for (const [pid, rel] of Object.entries(m.relations || {})) {
      const rid = '人:' + pid
      addNode(g, rid, 'person', pid, { intimacy: rel.intimacy, trust: rel.trust })
      addEdge(g, '李瑶', '认识', rid, Math.round((rel.intimacy || 0) * 10))
      for (const sh of (rel.shared || [])) {
        const sid = '共同经历:' + String(sh.text || '').slice(0, 30)
        addNode(g, sid, 'memory', String(sh.text || '').slice(0, 50), { at: sh.at })
        addEdge(g, '李瑶', '记得', sid, 2)
        addEdge(g, rid, '一起', sid, 2)
      }
      for (const p of (rel.promises || [])) {
        const pid2 = '承诺:' + String(p.text || '').slice(0, 30)
        addNode(g, pid2, 'promise', String(p.text || '').slice(0, 50), { done: p.done })
        addEdge(g, '李瑶', '欠着', pid2, 4)
        addEdge(g, rid, '承诺过', pid2, 4)
      }
    }
  } catch (e) { console.error('her-mind 读取失败:', e.message) }

  // ── 3. her-soul.json 的 semantic（她知道的事实）──
  try {
    const s = JSON.parse(readFileSync(`${HOME}/her-soul.json`, 'utf8'))
    const mem = s.memory || {}
    for (const f of (mem.semantic || [])) {
      const sub = String(f.subject || '')
      const pred = String(f.predicate || '')
      const obj = String(f.object || '')
      if (!sub || !pred) continue
      const subId = sub === 'user' ? '李瑶' : '事:' + sub
      addNode(g, subId, 'entity', sub === 'user' ? '李瑶' : sub)
      const obId = '知识:' + obj.slice(0, 30)
      addNode(g, obId, 'knowledge', obj.slice(0, 50), { full: obj })
      addEdge(g, subId, pred, obId, 2)
    }
    // relational 层
    for (const r of (mem.relational || [])) {
      if (r.kind && r.text) {
        const id = '关系:' + String(r.text).slice(0, 30)
        addNode(g, id, 'memory', String(r.text).slice(0, 50))
        addEdge(g, '李瑶', r.kind, id, 2)
      }
    }
    // episodic 层（她做过的事）
    for (const e of (mem.episodic || [])) {
      const id = '做过:' + String(e.what || '').slice(0, 25) + ':' + String(e.at || '').slice(11, 16)
      addNode(g, id, 'episode', String(e.what || '').slice(0, 40), { at: e.at, ok: e.kind === 'done' })
      addEdge(g, '李瑶', e.kind === 'done' ? '做成了' : '没做成', id, 1)
    }
  } catch (e) { console.error('her-soul 读取失败:', e.message) }

  // ── 4. 小说（她的创作）──
  try {
    const goals = JSON.parse(readFileSync(`${HOME}/her-mind.json`, 'utf8')).goals || []
    const novelGoal = goals.find(x => x.id === 'novel')
    if (novelGoal) {
      addNode(g, '小说:《陈默》', 'creation', '《陈默》', { chars: novelGoal.current })
      addEdge(g, '李瑶', '在写', '小说:《陈默》', 5)
      // 主线设定
      addNode(g, '设定:时间回溯', 'setting', '能回溯时间，代价是眼前发黑')
      addEdge(g, '小说:《陈默》', '设定', '设定:时间回溯', 3)
      addNode(g, '设定:便利店', 'setting', '便利店夜班')
      addEdge(g, '小说:《陈默》', '场景', '设定:便利店', 3)
      addNode(g, '角色:妈', 'character', '陈默的妈')
      addEdge(g, '小说:《陈默》', '角色', '角色:妈', 4)
    }
  } catch { }

  // ── 5. 猫 ──
  addNode(g, '猫:小鱼', 'pet', '小鱼', { species: '橘白猫', gotAt: '2021 冬天' })
  addEdge(g, '李瑶', '养着', '猫:小鱼', 8)
  addEdge(g, '猫:小鱼', '品种', '橘白猫', 5)

  // ── 6. 生活常识（从 semantic 里挑关键的）──
  const livingFacts = [
    ['李瑶', '住在', '洛阳洛龙新区', 5],
    ['李瑶', '月租', '1200 元', 3],
    ['李瑶', '第一单', '闲鱼改简历封面 15 元', 4],
    ['李瑶', '原则', '只信到账短信', 5],
    ['李瑶', '原则', '不解释，解释就是输', 5],
  ]
  for (const [a, rel, b, w] of livingFacts) {
    addNode(g, b, 'fact', b)
    addEdge(g, a, rel, b, w)
  }

  // ── 6.5 因果经验（2026-11-13 Step2：痛觉入图，只留最近 30 条）──
  try {
    const EF = HOME + '/her-experience.jsonl'
    if (existsSync(EF)) {
      const exps = readFileSync(EF, 'utf8').split('\n').filter(Boolean).slice(-30)
        .map(function (l) { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      for (const e of exps) {
        const eid = '经验:' + String(e.at || '').slice(5, 16) + ':' + String(e.goal || '-')
        const rel = e.ok ? '做成过' : '栽过'
        addNode(g, eid, 'experience', (e.ok ? '成' : '败') + ' ' + String(e.act || '') + ' · ' + String(e.reason || '').slice(0, 40),
          { ok: !!e.ok, act: e.act, reason: e.reason, at: e.at })
        addEdge(g, '李瑶', rel, eid, e.ok ? 2 : 3)
        if (e.goal) addEdge(g, eid, '关于目标', '目标:' + e.goal, 2)
        if (e.reason) {
          const rid = '原因:' + String(e.reason).replace(/[：:()（）;；,，]/g, ' ').slice(0, 24).trim()
          addNode(g, rid, 'cause', rid.replace('原因:', ''))
          addEdge(g, eid, '原因', rid, 3)
        }
      }
    }
  } catch (e) { console.error('经验入图失败:', e.message) }

  // ── 2026-11-13 清洗（幂等，每次 build 都跑）────────────────────────
  try {
    // 1) 重复宠物节点合并：事:小鱼 / 猫:小鱼 -> 宠物:小鱼
    const alias = { '事:小鱼': '宠物:小鱼', '猫:小鱼': '宠物:小鱼', '知识:user': '李瑶' }
    for (const oldId of Object.keys(alias)) {
      const newId = alias[oldId]
      if (!g.nodes[oldId]) continue
      if (oldId === '知识:user') { delete g.nodes[oldId]; continue }
      if (!g.nodes[newId]) {
        g.nodes[newId] = { type: 'pet', label: '小鱼（橘白猫）', attrs: Object.assign({}, g.nodes[oldId].attrs || {}) }
      } else {
        g.nodes[newId].attrs = Object.assign({}, g.nodes[newId].attrs || {}, g.nodes[oldId].attrs || {})
      }
      delete g.nodes[oldId]
      for (const e of g.edges) {
        if (e.from === oldId) e.from = newId
        if (e.to === oldId) e.to = newId
      }
    }
    // 2) 待归类：不删，标记
    if (g.nodes['知识:未知']) g.nodes['知识:未知'].attrs = Object.assign({}, g.nodes['知识:未知'].attrs, { pendingClassify: true })
    // 3) 与正典冲突的居住地：降权 + 标记（洛阳为准）
    for (const e of g.edges) {
      const other = e.from === '李瑶' ? e.to : (e.to === '李瑶' ? e.from : '')
      if (other.indexOf('杭州') >= 0) { e.weight = 1; e.conflict = 'canon=洛阳洛龙新区' }
    }
    // 4) 自我修正升格为元认知
    for (const id of Object.keys(g.nodes)) {
      const n = g.nodes[id]
      if (String(n.label).indexOf('不对——') >= 0) { n.type = 'metaCorrection'; n.attrs = Object.assign({}, n.attrs, { keep: true }) }
    }
    // 5) 脏标记清洗 + 悬挂边过滤
    for (const id of Object.keys(g.nodes)) {
      const n = g.nodes[id]
      if (String(n.label).indexOf('@@RESULT@@') >= 0) {
        const cleaned = String(n.label).replace(/@@RESULT@@/g, '').trim()
        n.label = cleaned || id
      }
    }
    g.edges = g.edges.filter(function (e) { return g.nodes[e.from] && g.nodes[e.to] })
    g.at = stamp()
  } catch (e) { console.error('graph clean 失败:', e.message) }

  if (write) writeFileSync(GRAPH, JSON.stringify(g, null, 2))
  return g
}

/** 从关键词联想：找到节点，走 2 跳但**不穿过中心节点**（2026-11-11 修）
 *  问题：李瑶 是中心节点，所有东西都连着她，走 2 跳会到所有东西。
 *  修：遍历时跳过「枢纽节点」（度数 > 8 的节点），避免泛化。 */
function recall(kw) {
  if (!existsSync(GRAPH)) return { err: '图不存在，先 build' }
  const g = JSON.parse(readFileSync(GRAPH, 'utf8'))
  const k = String(kw || '').toLowerCase()
  if (!k) return { err: '关键词为空' }

  // 算每个节点的度数
  const deg = {}
  for (const e of g.edges) {
    deg[e.from] = (deg[e.from] || 0) + 1
    deg[e.to] = (deg[e.to] || 0) + 1
  }
  const HUB_THRESHOLD = 8
  const isHub = id => (deg[id] || 0) > HUB_THRESHOLD

  // 找匹配的节点
  const hits = Object.entries(g.nodes)
    .filter(([id, n]) => id.toLowerCase().includes(k) || String(n.label).toLowerCase().includes(k))
    .map(([id]) => id)

  if (!hits.length) return { hits: [], edges: [] }

  // 走 2 跳，但不穿过枢纽
  const related = new Set(hits)
  let frontier = new Set(hits)
  for (let hop = 0; hop < 2; hop++) {
    const next = new Set()
    for (const e of g.edges) {
      // e.from 在 frontier 且 e.to 不是枢纽 → 加
      if (frontier.has(e.from) && !isHub(e.to)) next.add(e.to)
      if (frontier.has(e.to) && !isHub(e.from)) next.add(e.from)
    }
    for (const id of next) related.add(id)
    frontier = next
    if (!frontier.size) break
  }

  // 只保留相关节点之间的边，按权重排序
  const edges = g.edges
    .filter(e => related.has(e.from) && related.has(e.to) && !isHub(e.from) && !isHub(e.to))
    .sort((a, b) => (b.weight || 1) - (a.weight || 1))
    .slice(0, 20)

  return {
    hits: hits.map(id => ({ id, label: g.nodes[id]?.label, type: g.nodes[id]?.type })),
    nodes: [...related].map(id => ({ id, label: g.nodes[id]?.label, type: g.nodes[id]?.type, hub: isHub(id) })),
    edges,
  }
}

/* ══════ CLI ══════ */
const cmd = process.argv[2] || 'stats'
const arg = process.argv[3]

if (cmd === 'clean') {
  const apply = process.argv.includes('--apply')
  const before = existsSync(GRAPH) ? JSON.parse(readFileSync(GRAPH, 'utf8')) : { nodes: {}, edges: [], at: '' }
  const g = build(false)
  const bn = Object.keys(before.nodes || {}).length
  const be = (before.edges || []).length
  console.log('════ 记忆图清洗 ════')
  console.log('  清理前: 节点', bn, '关系', be, 'at', before.at)
  console.log('  清理后: 节点', Object.keys(g.nodes).length, '关系', g.edges.length)
  const removed = Object.keys(before.nodes || {}).filter(function (k) { return !g.nodes[k] })
  const added = Object.keys(g.nodes).filter(function (k) { return !(before.nodes || {})[k] })
  console.log('  消失节点:', removed.join(',') || '(无)')
  console.log('  新增节点:', added.slice(0, 12).join(',') || '(无)')
  const conflicts = g.edges.filter(function (e) { return e.conflict })
  console.log('  冲突边:', conflicts.map(function (e) { return e.from + '->' + e.to + '(' + e.conflict + ')' }).join(',') || '(无)')
  const pend = Object.keys(g.nodes).filter(function (k) { return g.nodes[k].attrs && g.nodes[k].attrs.pendingClassify })
  console.log('  待归类:', pend.join(',') || '(无)')
  const meta = Object.keys(g.nodes).filter(function (k) { return g.nodes[k].type === 'metaCorrection' })
  console.log('  元认知节点:', meta.join(',') || '(无)')
  if (apply) { writeFileSync(GRAPH, JSON.stringify(g, null, 2)); console.log('  已写入 ' + GRAPH) }
  else console.log('  dry-run：未写入（加 --apply 才落盘）')
}
if (cmd === 'build') {
  const g = build()
  console.log('════ 记忆图建好 ════')
  console.log('  节点:', Object.keys(g.nodes).length)
  console.log('  关系:', g.edges.length)
  const types = {}
  for (const n of Object.values(g.nodes)) types[n.type] = (types[n.type] || 0) + 1
  console.log('  节点类型:', JSON.stringify(types))
}

if (cmd === 'stats') {
  if (!existsSync(GRAPH)) { console.log('图不存在，先 build'); process.exit(0) }
  const g = JSON.parse(readFileSync(GRAPH, 'utf8'))
  console.log('════ 记忆图 ════')
  console.log('  建图时间:', g.at)
  console.log('  节点:', Object.keys(g.nodes).length)
  console.log('  关系:', g.edges.length)
  const types = {}
  for (const n of Object.values(g.nodes)) types[n.type] = (types[n.type] || 0) + 1
  console.log('  节点类型:', JSON.stringify(types))
  const rels = {}
  for (const e of g.edges) rels[e.rel] = (rels[e.rel] || 0) + 1
  console.log('  关系类型:', JSON.stringify(rels))
}

if (cmd === 'show') {
  if (!existsSync(GRAPH)) { console.log('图不存在，先 build'); process.exit(0) }
  const g = JSON.parse(readFileSync(GRAPH, 'utf8'))
  console.log('════ 记忆图 ════')
  for (const [id, n] of Object.entries(g.nodes)) {
    console.log(`  [${n.type}] ${n.label}`)
  }
  console.log('\n════ 关系 ════')
  for (const e of g.edges.slice(0, 50)) {
    console.log(`  ${g.nodes[e.from]?.label || e.from} --${e.rel}--> ${g.nodes[e.to]?.label || e.to}  (${e.weight})`)
  }
}

if (cmd === 'recall') {
  const r = recall(arg)
  if (r.err) { console.log(r.err); process.exit(0) }
  console.log(`════ 联想「${arg}」════`)
  console.log('  直接命中:', r.hits.length)
  for (const h of r.hits) console.log(`    [${h.type}] ${h.label}`)
  const others = r.nodes.filter(x => !r.hits.find(h => h.id === x.id))
  console.log('\n  两跳内相关:', others.length)
  for (const n of others.slice(0, 12)) {
    console.log(`    [${n.type}] ${n.label}`)
  }
  console.log('\n  关系:')
  for (const e of r.edges) {
    const f = r.nodes.find(n => n.id === e.from)?.label || e.from
    const t = r.nodes.find(n => n.id === e.to)?.label || e.to
    console.log(`    ${f} --${e.rel}--> ${t}`)
  }
}
