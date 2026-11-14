import shutil, time
NL=chr(10)
def rd(p): return open(p,encoding='utf-8').read()
def wr(p,s): open(p,'w',encoding='utf-8').write(s)
def bk(p):
    b=p+'.pre-hardening-'+time.strftime('%Y%m%d-%H%M%S'); shutil.copy2(p,b); print('BACKUP',b)

# ============ ① 备份：基线比较（7 天峰值 + 人工确认基线，跌 20% 告警） ============
B='/opt/her/her-backup.py'; bk(B); s=rd(B)

a="def backup_json(src, kind, counter):"
assert a in s
helpers=(
"def load_baseline():"+NL+
"    try:"+NL+
"        return json.load(open(os.path.join(BK, 'baseline.json'), encoding='utf-8'))"+NL+
"    except Exception:"+NL+
"        return {}"+NL+NL+
"def history_peak(kind, counter, days=7):"+NL+
"    out = {}"+NL+
"    cutoff = time.time() - days * 86400"+NL+
"    try:"+NL+
"        fs = os.listdir(os.path.join(BK, kind))"+NL+
"    except Exception:"+NL+
"        return out"+NL+
"    for f in sorted(fs):"+NL+
"        p = os.path.join(BK, kind, f)"+NL+
"        try:"+NL+
"            if os.path.getmtime(p) < cutoff:"+NL+
"                continue"+NL+
"            c = counter(p)"+NL+
"        except Exception:"+NL+
"            continue"+NL+
"        for k, v in c.items():"+NL+
"            if isinstance(v, int) and (k not in out or v > out[k]):"+NL+
"                out[k] = v"+NL+
"    return out"+NL+NL+
"def check_baseline(kind, cur, counter):"+NL+
"    base = load_baseline().get(kind, {})"+NL+
"    for name, ref in (('7天峰值', history_peak(kind, counter)), ('人工基线', base)):"+NL+
"        for k, v in cur.items():"+NL+
"            r = ref.get(k, 0)"+NL+
"            if isinstance(r, int) and r > 0 and v < r * 0.8:"+NL+
"                problems.append('%s.%s 低于%s %d（现在 %d）' % (kind, k, name, r, v))"+NL+NL
)
s=s.replace(a,helpers+a,1)

a="""    cur = counter(src)
    p = prev_of(kind)
    if p:
        try:
            check_drop(kind, cur, counter(os.path.join(BK, kind, p)))
        except Exception:
            pass"""
assert a in s
s=s.replace(a,"""    cur = counter(src)
    p = prev_of(kind)
    if p:
        try:
            check_drop(kind, cur, counter(os.path.join(BK, kind, p)))
        except Exception:
            pass
    if kind in ('soul', 'graph'):
        check_baseline(kind, cur, counter)""",1)

a="""    cur = db_counts(dst)
    p = prev_of('aiji')
    if p:
        try:
            check_drop('aiji', cur, db_counts(os.path.join(BK, 'aiji', p)))
        except Exception:
            pass"""
assert a in s
s=s.replace(a,"""    cur = db_counts(dst)
    p = prev_of('aiji')
    if p:
        try:
            check_drop('aiji', cur, db_counts(os.path.join(BK, 'aiji', p)))
        except Exception:
            pass
    check_baseline('aiji', cur, db_counts)""",1)

# ============ ② 备份告警接 QQ：写 NOTIFY-FATAL.txt（桥 5 分钟内发 QQ） ============
a="""    with open(NOTE, 'w', encoding='utf-8') as f:
        f.write('备份异常 ' + TAG + chr(10) + chr(10).join(problems) + chr(10))"""
assert a in s
s=s.replace(a,a+"""
    try:
        with open(H + '/NOTIFY-FATAL.txt', 'w', encoding='utf-8') as f:
            f.write('[' + TAG + '] backup-anomaly' + chr(10) + '; '.join(problems) + chr(10) + chr(10) +
                    '处理：看 /opt/her/NOTIFY-BACKUP.txt；回滚：/opt/her/_backup/<kind>/ 里挑上一版' + chr(10))
    except Exception:
        pass""",1)

# ============ 人工确认基线：--confirm ============
a="prune('soul', 60)"
assert a in s
s=s.replace(a,"""if '--confirm' in sys.argv:
    base = {'at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'soul': soul_counts(H + '/her-soul.json'),
            'graph': graph_counts(H + '/her-graph.json'),
            'aiji': db_counts(os.path.join(BK, 'aiji', 'aiji-' + TAG + '.db'))}
    with open(os.path.join(BK, 'baseline.json'), 'w', encoding='utf-8') as f:
        json.dump(base, f, ensure_ascii=False, indent=1)
    print('已写入人工基线 baseline.json: ' + json.dumps({k: len(v) if isinstance(v, dict) else v for k, v in base.items()}, ensure_ascii=False))

prune('soul', 60)""",1)
wr(B,s)
print('her-backup hardened')

# ============ ⑤ 关系信号冷启动：7 天数据前只记录不告警 ============
R='/opt/her/her-relationship.mjs'; bk(R); s=rd(R)
a="""  const out = {
    at: stamp(),"""
assert a in s
s=s.replace(a,"""  const dataDays = days.filter(d => (d.userMsgs + d.herMsgs) > 0).length
  const out = {
    at: stamp(),
    warmup: dataDays < 7,
    dataDays,""",1)
a="""    if (!s.healthy) {
      appendFileSync(ALERTS, JSON.stringify({ at: stamp(), level: 'medium', code: 'relation-signal', message: s.flags.join('; '), action: 'warn' }) + String.fromCharCode(10))
    }"""
assert a in s
s=s.replace(a,"""    if (!s.healthy && !s.warmup) {
      appendFileSync(ALERTS, JSON.stringify({ at: stamp(), level: 'medium', code: 'relation-signal', message: s.flags.join('; '), action: 'warn' }) + String.fromCharCode(10))
    }""",1)
wr(R,s)
print('relationship cold-start gated')

# ============ ③ 桥重启恢复 lastProactiveAt / lastUserMsgAt ============
G='/opt/herqq/bridge.mjs'; bk(G); s=rd(G)
a="  proactiveCountToday = loadProactiveCountToday()"
assert a in s
restore=(
"  proactiveCountToday = loadProactiveCountToday()"+NL+
"  // 2026-11-11 修重隐患③：重启后恢复冷却/静默时间戳"+NL+
"  //   原来 lastProactiveAt=0、lastUserMsgAt=0 → 桥一重启就绕过 25 分钟冷却/40 分钟静默，可能刚聊完又开口。"+NL+
"  try {"+NL+
"    const _pl = existsSync(PROACTIVE_LOG) ? readFileSync(PROACTIVE_LOG, 'utf8').split(String.fromCharCode(10)).filter(Boolean) : []"+NL+
"    if (_pl.length) {"+NL+
"      const _last = JSON.parse(_pl[_pl.length - 1])"+NL+
"      const _t = Date.parse(String(_last.at).replace(' ', 'T') + '+08:00')"+NL+
"      if (Number.isFinite(_t)) lastProactiveAt = _t"+NL+
"    }"+NL+
"    try {"+NL+
"      const _cf = existsSync(HOME + '/chats') ? readdirSync(HOME + '/chats').filter(x => x.endsWith('.jsonl')).sort() : []"+NL+
"      if (_cf.length) {"+NL+
"        const _rows = readFileSync(HOME + '/chats/' + _cf[_cf.length - 1], 'utf8').split(String.fromCharCode(10)).filter(Boolean)"+NL+
"        if (_rows.length) {"+NL+
"          const _r = JSON.parse(_rows[_rows.length - 1])"+NL+
"          const _t2 = Date.parse(String(_r.at).replace(' ', 'T') + '+08:00')"+NL+
"          if (Number.isFinite(_t2)) lastUserMsgAt = _t2"+NL+
"        }"+NL+
"      }"+NL+
"    } catch { }"+NL+
"    log('[启动] 恢复时间戳 lastProactiveAt=' + (lastProactiveAt ? new Date(lastProactiveAt).toISOString() : '0') + ' lastUserMsgAt=' + (lastUserMsgAt ? new Date(lastUserMsgAt).toISOString() : '0'))"+NL+
"  } catch { }"
)
s=s.replace(a,restore,1)
wr(G,s)
print('bridge restore patched')
