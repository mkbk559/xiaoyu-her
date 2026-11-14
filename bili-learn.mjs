/**
 * 她去 B站 刷视频学习
 *
 *   node bili-learn.mjs pick [--n 5]        从 B站排行榜挑几个可看的视频
 *   node bili-learn.mjs one                 挑一个 → 抽帧看 → 写笔记（这就是"刷视频学习"）
 *   node bili-learn.mjs search "<关键词>"    走搜索页（不稳定，备选）
 *   node bili-learn.mjs log                 看她刷过什么
 *
 * 为什么用排行榜而不是搜索（2026-11-09 实测）：
 *   B站搜索页在 headless 下时好时坏（evaluate 返回 null、只渲染导航）；
 *   排行榜页她本来就在读（day.mjs 的源之一），能稳定拿到标题+链接。
 * 看的动作交给 video-learn.mjs：yt-dlp 下载 → ffmpeg 抽帧 → 视觉模型逐帧看 + OCR 读画面字。
 */
import { spawn, execSync } from 'node:child_process'
import { readFileSync, appendFileSync, existsSync } from 'node:fs'

const EGO = '/opt/ego/package/runtime/ego-linux'
const LOG = '/opt/her/bili-log.jsonl'
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const readLines = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])

function run(script, timeoutMs = 90000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['bin/ego-browser.mjs', 'nodejs'], {
      cwd: EGO,
      env: { ...process.env, EGO_LINUX_HEADLESS: '1', EGO_LINUX_CHROME: `${EGO}/../../bin/ego-chrome-wrapper.sh`, EGO_LINUX_STATE_DIR: '/opt/ego/state' },
    })
    let out = ''
    let done = false
    const finish = () => { if (done) return; done = true; try { execSync("pkill -f 'chrome-linux' || true", { stdio: 'ignore' }) } catch {}; resolve(out) }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {}; finish() }, timeoutMs)
    child.stdout.on('data', d => { out += d.toString('utf8') })
    child.stderr.on('data', d => { out += d.toString('utf8') })
    child.on('close', () => { clearTimeout(timer); finish() })
    child.stdin.end(script)
  })
}

/** 她要接的活 → 该看什么视频（针对性，用户 2026-11-09 要求："学习需要针对性"） */
export const TOPICS = [
  { need: '菜单/海报设计', kw: '菜单设计 餐饮', why: '她 9/10 的强项，先把这块的活看明白' },
  { need: '本地商家内容服务', kw: '餐饮 短视频 探店 拍摄', why: '本地商家最常要的东西' },
  { need: '文案与推文', kw: '餐饮 文案 怎么写', why: '她的主接单品类' },
  { need: '小红书运营引流', kw: '小红书 运营 引流 接单', why: '她自己定的引流路线' },
  { need: '报价与收款', kw: '接单 报价 防坑', why: '防白嫖、防赖账' },
  { need: '粗剪', kw: '短视频 剪辑 入门', why: '她只能粗剪，得知道粗剪能交付什么' },
]

/** 从知识区排行榜拿视频（稳），或用关键词搜索（针对性强但 headless 下不稳） */
export async function pick({ n = 5, zone = 'knowledge', keyword = '' } = {}) {
  const url = keyword
    ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`
    : `https://www.bilibili.com/v/popular/rank/${zone}`
  const script = [
    `await createTab(${JSON.stringify(url)})`,
    `await page.waitForLoadState('domcontentloaded')`,
    `let ready = false`,
    `try { await page.waitForSelector('a[href*="/video/BV"]', { timeout: 20000 }); ready = true } catch (e) {}`,
    `console.log('READY>>>' + ready)`,
    `await page.waitForTimeout(3000)`,
    `const total = await page.locator('a[href*="/video/BV"]').count()`,
    `console.log('TOTAL>>>' + total)`,
    `const seen = {}`,
    `const out = []`,
    `for (let i = 0; i < Math.min(total, 60); i++) {`,
    `  try {`,
    `    const el = page.locator('a[href*="/video/BV"]').nth(i)`,
    `    const href = await el.getAttribute('href')`,
    `    const title = (await el.getAttribute('title')) || (await el.innerText()) || ''`,
    `    const m = String(href || '').match(/\\/video\\/(BV[0-9A-Za-z]+)/)`,
    `    if (!m) continue`,
    `    if (seen[m[1]]) continue`,
    `    seen[m[1]] = 1`,
    `    out.push({ bv: m[1], title: String(title).replace(/\\s+/g, ' ').trim().slice(0, 60) })`,
    `  } catch (e) {}`,
    `}`,
    `console.log('ITEMS>>>' + JSON.stringify(out))`,
  ].join('\n') + '\n'
  const out = await run(script, 110000)
  const seg = k => (out.match(new RegExp(k + '>>>([\\s\\S]*?)(?:\\n[A-Z]+>>>|$)')) || [])[1]?.trim() || ''
  let list = []
  try { const a = JSON.parse(seg('ITEMS')); list = Array.isArray(a) ? a : [] } catch {}
  if (process.env.BILI_DEBUG) console.error('READY=', seg('READY'), 'TOTAL=', seg('TOTAL'), 'ITEMS=', list.length)
  return list.map(v => ({ ...v, url: `https://www.bilibili.com/video/${v.bv}` })).slice(0, n)
}

const cmd = process.argv[2]
if (String(process.argv[1] || '').endsWith('bili-learn.mjs')) {
  if (cmd === 'pick') {
    const i = process.argv.indexOf('--n')
    const zi = process.argv.indexOf('--zone')
    const l = await pick({ n: i > 0 ? Number(process.argv[i + 1]) : 5, zone: zi > 0 ? process.argv[zi + 1] : 'knowledge' })
    if (!l.length) console.log('没挑到视频（页面没渲染出链接）')
    for (const v of l) console.log(v.bv + '  ' + v.title)
  } else if (cmd === 'one') {
    // 针对性：按"她要接的活"轮换关键词，而不是随机刷
    const ki = process.argv.indexOf('--kw')
    const t = ki > 0
      ? { need: '指定', kw: process.argv[ki + 1], why: '手动指定' }
      : TOPICS[new Date().getDate() % TOPICS.length]
    console.log('学习方向：' + t.need + '（搜「' + t.kw + '」）—— ' + t.why)
    let l = await pick({ n: 8, keyword: t.kw })
    if (!l.length) {                       // 搜索页不稳就退回排行榜
      console.log('（搜索没出结果，退回知识区排行榜）')
      l = await pick({ n: 8, zone: 'knowledge' })
    }
    if (!l.length) { console.log('没挑到视频'); process.exit(1) }
    const v = l[Math.floor(Math.random() * l.length)]
    console.log('挑中：' + v.title + '  ' + v.url)
    appendFileSync(LOG, JSON.stringify({ at: stamp(), need: t.need, kw: t.kw, picked: v.bv, title: v.title, url: v.url }) + '\n')
    const { learn } = await import('/opt/her/video-learn.mjs')
    const r = await learn(v.url, { frames: 5 })
    console.log(JSON.stringify({ title: r.title, frames: r.frames, file: r.file, note: (r.note || r.error || '').slice(0, 400) }, null, 1))
  } else if (cmd === 'log') {
    console.log(JSON.stringify(readLines(LOG).slice(-8), null, 1))
  } else console.log('用法: pick [--n 5] | one | log')
}


