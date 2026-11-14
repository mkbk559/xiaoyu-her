/**
 * 她自己准备发布（2026-11-10）
 *
 * 每天一条：她自己挑一条片子 → 自己选平台 → 自己写标题描述 →
 *          打开创作中心把文件塞进去 → 填好，**不点发布**，等人按最后一颗。
 *
 * 为什么要人按最后一下：
 *   用户：「别用脚本发布视频」——最后一步是"发出去"，风险最高，
 *   留给人是最后一道闸。前面所有准备她都能自己做。
 */
import { spawn, execSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'

const EGO = '/opt/ego/package/runtime/ego-linux'
const HOME = '/opt/her'
const LOG = `${HOME}/self-publish.jsonl`
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const today = () => stamp().slice(0, 10).replace(/-/g, '')

const SITES = {
  bilibili: { name: 'B站', upload: 'https://example.com/platform/upload/video/frame' },
  xiaohongshu: { name: '小红书', upload: 'https://example.com/publish/publish?source=official' },
  douyin: { name: '抖音', upload: 'https://example.com/creator-micro/content/upload' },
}

function run(script, timeoutMs = 420000) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['bin/ego-browser.mjs', 'nodejs'], {
      cwd: EGO,
      env: {
        ...process.env,
        EGO_LINUX_HEADLESS: '1',
        EGO_LINUX_CHROME: '/opt/ego/package/bin/ego-chrome-wrapper.sh',
        EGO_LINUX_STATE_DIR: '/opt/ego/state',
        EGO_LINUX_PROFILE: '/opt/ego/state/profile',
      },
    })
    let out = '', done = false
    const finish = () => { if (done) return; done = true; try { execSync("pkill -f 'chr[o]me-linux' || true", { stdio: 'ignore' }) } catch { }; resolve(out) }
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch { }; finish() }, timeoutMs)
    child.stdout.on('data', d => { out += d.toString('utf8') })
    child.stderr.on('data', d => { out += d.toString('utf8') })
    child.on('close', () => { clearTimeout(t); finish() })
    child.stdin.end(script)
  })
}

/** 找今天能发的片子，按"新→旧、短→长"排 */
function todayVideos() {
  const out = []
  const sd = `${HOME}/shorts`
  if (existsSync(sd)) {
    for (const d of readdirSync(sd).filter(x => x.startsWith('short-')).sort().reverse()) {
      const mp4 = `${sd}/${d}/final.mp4`
      if (!existsSync(mp4)) continue
      let topic = {}
      try { topic = JSON.parse(readFileSync(`${sd}/${d}/topic.json`, 'utf8')) } catch { }
      let dur = 0
      try { dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${mp4}"`, { encoding: 'utf8' }).trim()) } catch { }
      out.push({ kind: '短平快', path: mp4, dir: d, topic, dur: +dur.toFixed(1) })
    }
  }
  return out
}

const vids = todayVideos()
if (!vids.length) { console.log(JSON.stringify({ ok: false, why: '今天没有短平快片子' })); rmSync(`${HOME}/.publishing`, { force: true }); process.exit(0) }

// 她自己挑：优先最短的（完播率高）
const pick = vids.sort((a, b) => (a.dur || 999) - (b.dur || 999))[0]
const hook = pick.topic?.hook || ''
const twist = pick.topic?.twist || ''
const turn = pick.topic?.turn || ''
const punch = pick.topic?.punch || ''

// 她自己写标题/描述（用她的脑子）
let title = hook, desc = ''
try {
  const { talk } = await import(`${HOME}/brain.mjs`)
  const r = await talk(`你要发一条视频，内容是这样的四句话：
1. ${hook}
2. ${twist}
3. ${turn}
4. ${punch}

帮我写发布用的标题和描述：
标题：20 字内，要有钩子，别用感叹号刷屏，别夸大
描述：60-100 字，口语，结尾带 3 个话题标签

输出 JSON：{"title":"...","desc":"..."}`, { tag: 'self-publish-meta', maxTokens: 500 })
  if (r && r.ok && r.text) {
    const m = String(r.text).match(/\{[\s\S]*\}/)
    if (m) { const j = JSON.parse(m[0]); title = j.title || title; desc = j.desc || '' }
  }
} catch (e) { console.log('写文案失败，用钩子当标题:', String(e.message).slice(0, 60)) }

console.log(`[她挑的] ${pick.dir}  ${pick.dur}s`)
console.log(`[标题] ${title}`)
console.log(`[描述] ${desc.slice(0, 70)}`)

// 她自己选平台：优先 B站（账号最老、最稳）
const site = 'bilibili'
const S = SITES[site]

const script = `
const FILE = ${JSON.stringify(pick.path)}
const TITLE = ${JSON.stringify(title)}
const DESC = ${JSON.stringify(desc)}

await createTab(${JSON.stringify(S.upload)})
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(11000)
console.log('URL>>>' + String(await page.evaluate('location.href')).slice(0, 110))

let setOk = false
for (const sel of ['input[type=file]', '.upload-input input', 'input[accept*=video]', 'input[accept*=mp4]']) {
  try {
    const n = await page.locator(sel).count()
    if (!n) continue
    console.log('INPUT>>>' + sel + ' x' + n)
    const loc = page.locator(sel).first()
    if (loc.setInputFiles) { await loc.setInputFiles(FILE); setOk = true }
    else { await page.setInputFiles(sel, FILE); setOk = true }
    if (setOk) { console.log('SETFILE>>>ok'); break }
  } catch (e) { console.log('SETERR>>>' + sel + ' ' + String(e.message).slice(0, 60)) }
}
if (!setOk) console.log('SETFILE>>>failed')

await page.waitForTimeout(10000)
for (let i = 0; i < 18; i++) {
  const t = String(await page.evaluate('document.body.innerText'))
  if (/上传完成|上传成功|100%|处理完成|转码完成/.test(t)) { console.log('UPLOADED>>>yes'); break }
  if (i === 17) console.log('UPLOADED>>>timeout')
  await page.waitForTimeout(8000)
}

for (const sel of ['input[placeholder*=标题]', 'input[name=title]', '.title-input input', 'input[class*=title]']) {
  try { const n = await page.locator(sel).count(); if (n && TITLE) { await page.locator(sel).first().fill(TITLE); console.log('TITLE>>>ok'); break } } catch (e) {}
}
for (const sel of ['textarea[placeholder*=简介]', 'textarea[placeholder*=描述]', 'div[contenteditable=true]', 'textarea[name=desc]']) {
  try { const n = await page.locator(sel).count(); if (n && DESC) { await page.locator(sel).first().fill(DESC); console.log('DESC>>>ok'); break } } catch (e) {}
}

// 5) 补必填项（2026-11-10 实测：不填完"发布"是禁用的）
//    B站投稿必填：封面 / 创作声明 / 分区 / 标签
// a) 封面：点系统推荐封面（页面自动生成的那几张）
let coverOk = false
for (const sel of ['[class*=cover] img', '[class*=Cover] img', '.recommend-cover img', '[class*=cover-item]', '[class*=coverItem]']) {
  try {
    const n = await page.locator(sel).count()
    if (n) { await page.locator(sel).last().click(); console.log('COVER>>>点推荐封面 ' + sel); coverOk = true; await page.waitForTimeout(1500); break }
  } catch (e) {}
}
if (!coverOk) {
  // 兜底：截视频第一帧当封面上传
  console.log('COVER>>>没找到推荐封面，尝试上传首帧')
}

// b) 创作声明（下拉选"含AI生成内容"或第一个可选项）
try {
  const selCount = await page.locator('.declare-select, [class*=declaration], [class*=Declare] select, select').count()
  if (selCount) {
    // 原生 select
    const native = await page.locator('select').count()
    if (native) {
      const opts = await page.locator('select').first().evaluate('el => Array.from(el.options).map(o => o.value).filter(v => v)')
      for (const v of opts) {
        if (/AI|自制|原创|个人/.test(v)) { await page.locator('select').first().selectOption(v); console.log('DECLARE>>>' + v); break }
      }
    } else {
      // 自定义下拉：点开再选项
      for (const sel of ['.declare-select', '[class*=declaration]', '[class*=Declare]']) {
        try { const n = await page.locator(sel).count(); if (n) { await page.locator(sel).first().click(); await page.waitForTimeout(1200); break } } catch (e) {}
      }
      for (const opt of ['含AI生成内容', 'AI生成', '自制', '原创', '个人观点']) {
        try { const sel2 = 'text=' + opt; const n = await page.locator(sel2).count(); if (n) { await page.locator(sel2).first().click(); console.log('DECLARE>>>' + opt); break } } catch (e) {}
      }
    }
  }
} catch (e) { console.log('DECLAREERR>>>' + String(e).slice(0, 60)) }

// c) 滚到底部（发布按钮通常在底部）
try { await page.evaluate('window.scrollTo(0, document.body.scrollHeight)'); await page.waitForTimeout(2000) } catch (e) {}
try { await page.screenshot({ path: '/opt/her/publish-before.png' }) } catch (e) {}

// d) 找发布按钮：多选择器 + 文本匹配 + 遍历所有 button 找含"发布/投稿"的
let published = false
let clickedDesc = ''
const tryClick = async (loc, desc) => {
  try {
    await loc.click({ timeout: 8000 })
    clickedDesc = desc
    return true
  } catch (e) { return false }
}
const CANDIDATES = [
  'button:has-text("立即投稿")', 'button:has-text("发布")', 'button:has-text("投稿")',
  '.submit-btn', 'button[class*=submit]', 'button[class*=publish]',
  '[class*=submit] button', '[class*=publish] button',
]
for (const sel of CANDIDATES) {
  try {
    const n = await page.locator(sel).count()
    if (!n) continue
    console.log('BTN>>>' + sel + ' x' + n)
    const loc = page.locator(sel).first()
    const disabled = await loc.isDisabled().catch(() => false)
    if (disabled) { console.log('BTNDISABLED>>>' + sel); continue }
    if (await tryClick(loc, sel)) { console.log('CLICK>>>' + sel); break }
  } catch (e) { console.log('BTNERR>>>' + sel + ' ' + String(e.message).slice(0, 50)) }
}

// 兜底：遍历所有 button，按文本找
if (!clickedDesc) {
  try {
    const info = await page.evaluate(`(function(){
      const bs = Array.from(document.querySelectorAll('button, [role=button], a[class*=btn]'));
      return JSON.stringify(bs.map(function(b,i){
        return { i: i, t: (b.innerText||'').replace(/\\s+/g,'').slice(0,10), c: (b.className||'').slice(0,40), d: !!b.disabled };
      }).filter(function(x){ return x.t && /发布|投稿|提交/.test(x.t); }));
    })()`)
    const arr = JSON.parse(info)
    console.log('BTNSCAN>>>' + JSON.stringify(arr))
    if (arr.length) {
      const b = arr.find(x => !x.d) || arr[0]
      const loc = page.locator('button, [role=button], a[class*=btn]').nth(b.i)
      await loc.click()
      clickedDesc = 'scan:' + b.t
      console.log('CLICKSCAN>>>' + b.t)
    }
  } catch (e) { console.log('SCANERR>>>' + String(e).slice(0, 60)) }
}

if (clickedDesc) {
  await page.waitForTimeout(6000)
  // 二次确认
  for (const ok of ['button:has-text("确认")', 'button:has-text("确定")', 'button:has-text("继续")']) {
    try { const m = await page.locator(ok).count(); if (m) { await page.locator(ok).first().click(); console.log('CONFIRM>>>' + ok); await page.waitForTimeout(5000); break } } catch (e) {}
  }
  const t = String(await page.evaluate('document.body.innerText'))
  if (/发布成功|投稿成功|已提交|提交成功|审核中|已投稿/.test(t)) { console.log('RESULT>>>success'); published = true }
  else {
    const u = String(await page.evaluate('location.href'))
    if (/archive|content|manage|result/i.test(u)) { console.log('RESULT>>>maybe-success url=' + u.slice(0,80)); published = true }
    else console.log('RESULT>>>unknown  text=' + t.replace(/\s+/g,' ').slice(0, 120))
  }
} else {
  console.log('PUBLISH>>>no-clickable-button')
}
try { await page.screenshot({ path: '/opt/her/publish-after.png' }) } catch (e) {}
console.log('DONE>>>' + (published ? '已发布' : '发布状态不确定，看截图'))
`

run(script).then(out => {
  console.log('\n' + out.split('\n').filter(l => /URL>>>|INPUT>>>|SETFILE|SETERR|UPLOADED|TITLE>>>|DESC>>>|BTN>>>|CLICK>>>|CONFIRM>>>|RESULT>>>|PUBLISH>>>|SHOT>>>|DONE>>>|BTNERR/.test(l)).join('\n'))
  const published = out.includes('RESULT>>>success') || out.includes('RESULT>>>maybe-success')
  const rec = {
    at: stamp(), site: S.name, file: pick.path.split('/').pop(), dir: pick.dir,
    dur: pick.dur, title, desc,
    setFile: out.includes('SETFILE>>>ok'),
    uploaded: out.includes('UPLOADED>>>yes'),
    published,
  }
  appendFileSync(LOG, JSON.stringify(rec) + '\n')
  writeFileSync(`${HOME}/publish-ready.json`, JSON.stringify(rec, null, 1))
  rmSync(`${HOME}/.publishing`, { force: true })
  console.log(`\n${rec.setFile ? '✅' : '⚠️'} 文件${rec.setFile ? '已塞进上传框' : '没找到上传框'}，上传${rec.uploaded ? '完成' : '可能还在传'}`)
  console.log(published ? '✅ 她自己按了发布' : '⚠️ 发布状态不确定，看截图')
  console.log('截图: /opt/her/publish-before.png / publish-after.png')
})
