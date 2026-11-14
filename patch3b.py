import shutil, time
NL=chr(10)
p='/opt/herqq/bridge.mjs'
shutil.copy2(p, p+'.pre-hardening-'+time.strftime('%Y%m%d-%H%M%S'))
s=open(p,encoding='utf-8').read()
a="proactiveCountToday = loadProactiveCountToday()"
assert s.count(a)==1
restore=(
a+NL+
"// 2026-11-11 修重隐患③：重启后恢复冷却/静默时间戳"+NL+
"//   原来 lastProactiveAt=0、lastUserMsgAt=0 → 桥一重启就绕过 25 分钟冷却/40 分钟静默，可能刚聊完又开口。"+NL+
"try {"+NL+
"  const _pl = existsSync(PROACTIVE_LOG) ? readFileSync(PROACTIVE_LOG, 'utf8').split(String.fromCharCode(10)).filter(Boolean) : []"+NL+
"  if (_pl.length) {"+NL+
"    const _last = JSON.parse(_pl[_pl.length - 1])"+NL+
"    const _t = Date.parse(String(_last.at).replace(' ', 'T') + '+08:00')"+NL+
"    if (Number.isFinite(_t)) lastProactiveAt = _t"+NL+
"  }"+NL+
"  try {"+NL+
"    const _cf = existsSync(HOME + '/chats') ? readdirSync(HOME + '/chats').filter(x => x.endsWith('.jsonl')).sort() : []"+NL+
"    if (_cf.length) {"+NL+
"      const _rows = readFileSync(HOME + '/chats/' + _cf[_cf.length - 1], 'utf8').split(String.fromCharCode(10)).filter(Boolean)"+NL+
"      if (_rows.length) {"+NL+
"        const _r = JSON.parse(_rows[_rows.length - 1])"+NL+
"        const _t2 = Date.parse(String(_r.at).replace(' ', 'T') + '+08:00')"+NL+
"        if (Number.isFinite(_t2)) lastUserMsgAt = _t2"+NL+
"      }"+NL+
"    }"+NL+
"  } catch { }"+NL+
"  log('[启动] 恢复时间戳 active=' + (lastProactiveAt ? new Date(lastProactiveAt).toISOString() : '0') + ' user=' + (lastUserMsgAt ? new Date(lastUserMsgAt).toISOString() : '0'))"+NL+
"} catch { }"
)
s=s.replace(a,restore,1)
open(p,'w',encoding='utf-8').write(s)
print('bridge restore patched')
