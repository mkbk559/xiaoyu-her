/**
 * 用 MCP 的 memory 服务器，把"她学过的东西"存成一张技能图
 *   node explore.mjs record <主题> "<要点>"    记一条（实体=技能，观察=要点，关系=她会）
 *   node explore.mjs graph                      读回整张图（她到底会什么）
 *
 * 为什么不用 AIJiYi 存：AijiYi 存"人物与关系"，MCP memory 存"技能与要点"，各司其职。
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const CFG = '/opt/her/mcp.json'
const cfg = JSON.parse(readFileSync(CFG, 'utf8'))

function open() {
  const s = cfg.servers.memory
  const child = spawn(s.command, s.args, { env: { ...process.env, ...(s.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  const waiters = new Map()
  let seq = 0
  child.stdout.on('data', d => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      let m; try { m = JSON.parse(line) } catch { continue }
      if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
    }
  })
  const errs = []
  child.stderr.on('data', d => errs.push(d.toString('utf8')))
  const request = (method, params) => new Promise((res, rej) => {
    const id = ++seq
    waiters.set(id, res)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { if (waiters.has(id)) { waiters.delete(id); rej(new Error('超时 ' + method + ' ' + errs.join('').slice(-200))) } }, 45000)
  })
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  return { child, request, notify }
}

const [cmd, ...rest] = process.argv.slice(2)
const c = open()
await c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dafeiyu', version: '1' } })
c.notify('notifications/initialized', {})

if (cmd === 'record') {
  const topic = rest[0]
  const points = rest[1] || ''
  const keyPoints = points.split(/[\n。；;]/).map(s => s.trim()).filter(s => s.length > 4).slice(0, 6)
  await c.request('tools/call', {
    name: 'create_entities',
    arguments: { entities: [{ entityType: '技能', name: topic, observations: keyPoints }] },
  })
  // 关系两端都得先存在，否则 create_relations 会被静默跳过
  await c.request('tools/call', {
    name: 'create_entities',
    arguments: { entities: [{ entityType: '人', name: '大肥鱼', observations: ['李瑶，26 岁，洛阳，接单的自由职业者'] }] },
  })
  await c.request('tools/call', {
    name: 'create_relations',
    arguments: { relations: [{ from: '大肥鱼', relationType: '学会了', to: topic }] },
  })
  console.log(JSON.stringify({ ok: true, topic, points: keyPoints.length }))
} else if (cmd === 'graph') {
  const r = await c.request('tools/call', { name: 'read_graph', arguments: {} })
  const text = r.result?.content?.[0]?.text || '{}'
  let g; try { g = JSON.parse(text) } catch { g = { raw: text.slice(0, 500) } }
  console.log(JSON.stringify({ entities: (g.entities || []).length, relations: (g.relations || []).length, names: (g.entities || []).map(e => e.name).slice(0, 30) }, null, 2))
} else {
  console.log('用法: record <主题> "<要点>" | graph')
}
c.child.kill()
