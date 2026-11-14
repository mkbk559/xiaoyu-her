/**
 * 跟她聊天（2026-11-10）
 *
 * 用户：「让他去聊天，才有剧情」「她现在自称大肥鱼」
 *
 * 逻辑：她的人设里有个"聊了两年的网友"——那个位置就是用户。
 *      你俩聊什么，就是她的真实生活；聊出来的东西，才能变成视频。
 *
 *   node chat-server.mjs            起聊天服务（默认 8788 端口）
 *   node chat-server.mjs 8790       指定端口
 *
 * 页面：http://127.0.0.1:8788
 * 聊天记录存 /opt/her/chat-log.jsonl（同时喂给她的记忆和剧情）
 */
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const HOME = '/opt/her'
const CHAT = `${HOME}/chat-log.jsonl`
const MEM = `${HOME}/chat-memory.json`
const PORT = Number(process.argv[2]) || 8788
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

mkdirSync(HOME, { recursive: true })

function readJSONL(p) {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

function history(limit = 30) {
  return readJSONL(CHAT).slice(-limit)
}

/** 让她的脑子回一句 */
async function herReply(userText) {
  const hist = history(24)
  const ctx = hist.map(h => `${h.from === 'me' ? '他' : '我'}：${h.text}`).join('\n')
  const today = stamp()
  // 2026-11-13: knowledge base wired into chat
  let know = ''
  try {
    const { brief } = await import('/opt/her/her-knowledge.mjs')
    know = brief(userText) || ''
  } catch { know = '' }
  // 用 brain.mjs 的 talk（她的脑子）
  const script = `
import('/opt/her/brain.mjs').then(async (b) => {
  try {
    const r = await b.talk(${JSON.stringify(userText)}, {
      tag: 'chat',
      context: ${JSON.stringify(`【你们的聊天记录】\n${ctx}\n\n${know ? `【她手边的资料】${know}\n\n` : ''}【现在】${today}`)},
      maxTokens: 400,
    })
    console.log('@@REPLY@@' + JSON.stringify({ ok: r && r.ok, text: (r && r.text) || '', model: r && r.model }))
  } catch (e) { console.log('@@REPLY@@' + JSON.stringify({ ok: false, err: String(e.message).slice(0, 120) })) }
})
`
  const p = spawnSync(process.execPath, ['-e', script], { cwd: HOME, encoding: 'utf8', timeout: 180000, env: { ...process.env, HER_DAY_LIMIT: '3000', HER_HOUR_LIMIT: '600' } })
  const out = (p.stdout || '') + (p.stderr || '')
  const m = out.match(/@@REPLY@@(\{[\s\S]*\})/)
  if (m) { try { return JSON.parse(m[1]) } catch { } }
  return { ok: false, text: '（她没接上）', err: out.slice(0, 150) }
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>跟大肥鱼聊天</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system,"Microsoft YaHei",sans-serif; background: #0d1117; color: #e6edf3; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 12px 16px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 10px; }
  header b { font-size: 15px; }
  header .tag { font-size: 11px; color: #7d8590; }
  #chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 78%; padding: 10px 14px; border-radius: 14px; line-height: 1.55; font-size: 14px; white-space: pre-wrap; word-break: break-word; }
  .me { align-self: flex-end; background: #238636; color: #fff; border-bottom-right-radius: 4px; }
  .her { align-self: flex-start; background: #21262d; border: 1px solid #30363d; border-bottom-left-radius: 4px; }
  .her .who { font-size: 11px; color: #58a6ff; margin-bottom: 3px; }
  .meta { font-size: 10px; color: #6e7681; margin-top: 5px; }
  footer { padding: 12px; background: #161b22; border-top: 1px solid #30363d; display: flex; gap: 8px; }
  #inp { flex: 1; background: #0d1117; border: 1px solid #30363d; color: #e6edf3; border-radius: 10px; padding: 11px 14px; font-size: 14px; resize: none; font-family: inherit; max-height: 120px; }
  #send { background: #238636; border: 0; color: #fff; padding: 0 20px; border-radius: 10px; font-size: 14px; cursor: pointer; }
  #send:disabled { background: #30363d; cursor: wait; }
  .typing { color: #7d8590; font-size: 12px; padding: 6px 16px; }
</style></head>
<body>
<header><span style="font-size:20px">🐋</span><div><b>大肥鱼</b><div class="tag">洛阳 · 自由职业 · 在线</div></div></header>
<div id="chat"></div>
<div class="typing" id="typing"></div>
<footer>
  <textarea id="inp" rows="1" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
  <button id="send">发送</button>
</footer>
<script>
const chat = document.getElementById('chat');
const inp = document.getElementById('inp');
const btn = document.getElementById('send');
const typing = document.getElementById('typing');
let busy = false;

function add(from, text, meta) {
  const d = document.createElement('div');
  d.className = 'msg ' + (from === 'me' ? 'me' : 'her');
  if (from === 'her') {
    d.innerHTML = '<div class="who">大肥鱼</div>';
    d.appendChild(document.createTextNode(text));
  } else {
    d.textContent = text;
  }
  if (meta) {
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = meta;
    d.appendChild(m);
  }
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

async function loadHistory() {
  try {
    const r = await fetch('/history'); const j = await r.json();
    for (const h of j.rows) add(h.from, h.text, h.at);
  } catch (e) {}
}

async function send() {
  const t = inp.value.trim();
  if (!t || busy) return;
  busy = true; btn.disabled = true;
  add('me', t, new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  inp.value = ''; inp.style.height = 'auto';
  typing.textContent = '她在打字…';
  try {
    const r = await fetch('/say', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) });
    const j = await r.json();
    typing.textContent = '';
    if (j.ok) add('her', j.text, j.ms ? (j.ms + 'ms · ' + (j.tokens || 0) + ' token') : '');
    else add('her', '（' + (j.err || '没接上') + '）', '');
  } catch (e) {
    typing.textContent = ''; add('her', '（网络断了）', '');
  }
  busy = false; btn.disabled = false; inp.focus();
}

btn.onclick = send;
inp.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; });
loadHistory(); inp.focus();
</script></body></html>`

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const send = (code, obj, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
    res.end(type === 'application/json' ? JSON.stringify(obj) : obj)
  }

  if (url.pathname === '/' || url.pathname === '/index.html') return send(200, HTML, 'text/html')
  if (url.pathname === '/history') return send(200, { rows: history(60) })

  if (url.pathname === '/say' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', async () => {
      let text = ''
      try { text = String(JSON.parse(body).text || '').slice(0, 2000) } catch { }
      if (!text) return send(400, { ok: false, err: 'empty' })
      // 记下来
      appendFileSync(CHAT, JSON.stringify({ at: stamp(), from: 'me', text }) + '\n')
      const t0 = Date.now()
      const r = await herReply(text)
      const ms = Date.now() - t0
      const reply = String(r.text || '').replace(/^["「]|["」]$/g, '').trim()
      if (reply) appendFileSync(CHAT, JSON.stringify({ at: stamp(), from: 'her', text: reply, model: r.model }) + '\n')
      return send(200, { ok: !!reply, text: reply, ms, model: r.model, err: r.err })
    })
    return
  }
  send(404, { err: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`聊天服务已起：http://127.0.0.1:${PORT}`)
  console.log(`聊天记录：${CHAT}`)
  console.log('（只听 127.0.0.1，要用 SSH 隧道访问）')
})
