#!/opt/her/.venv/bin/python
# -*- coding: utf-8 -*-
"""大肥鱼 手机桥 v2（2026-11-14 00:1x）
用 phoneops.py 作为手和眼（adb + uiautomator dump + ADBKeyboard），不再依赖 uiautomator2 的常驻会话。
  python phone-bridge2.py           常驻
  python phone-bridge2.py --once    处理一轮就退出（用来验收/排障）
"""
import subprocess, sys, time, json, os, re, urllib.request

HOME = '/opt/her'
PY = HOME + '/.venv/bin/python'
OPS = HOME + '/phoneops.py'
LOG = HOME + '/phone-log.jsonl'
STATE = HOME + '/phone-bridge-state.json'
STOP = HOME + '/PHONE-STOP'
NAME = '霸王辣条丝'
NOISE = {'发送消息', '消息', '在线', '限时日常', '状态设置', '智能助手', '点击查看', '回复',
         '暂时没有更多了', '续火花', '已读', '新关注我的移至互动消息', '首页', '朋友', '我',
         '拍摄，按钮', NAME, '装扮', '搜索', '更多面板', '音视频通话', NAME + '的头像', '大肥鱼996的头像'}
TIME_RE = re.compile(r'^(\d{1,2}:\d{2}|昨天.*|刚刚|\d+\s*天[前后].*)$')

def log(o):
    o['at'] = time.strftime('%Y-%m-%d %H:%M:%S')
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(o, ensure_ascii=False) + '\n')

def ops(*args, timeout=45):
    try:
        r = subprocess.run([PY, OPS] + list(args), capture_output=True, text=True, timeout=timeout)
        return (r.stdout or '') + (r.stderr or '')
    except Exception as e:
        return ''

def texts():
    out = ops('texts')
    nodes = []
    for line in out.splitlines():
        m = re.match(r'^([TD])\s+(.*?)\s*\|\s*(\d+)\s+(\d+)\s*$', line)
        if not m:
            continue
        nodes.append({'kind': m.group(1), 't': m.group(2).strip(), 'x': int(m.group(3)), 'y': int(m.group(4))})
    return nodes

def tap(x, y):
    ops('tap', str(int(x)), str(int(y)))

def load_state():
    try:
        return json.load(open(STATE, encoding='utf-8'))
    except Exception:
        return {'last_reply': '', 'last_user': '', 'day': '', 'count': 0, 'last_at': 0}

def save_state(s):
    json.dump(s, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)

def ask_aiji(text):
    for w in ('参数错误', '系统繁忙', '服务异常'):
        text = text.replace(w, '那个报错')
    body = json.dumps({'model': 'aiji', 'user': 'desktop:dafeiyu',
                       'messages': [{'role': 'user', 'content': text[:1200]}], 'max_tokens': 200}).encode()
    req = urllib.request.Request('http://127.0.0.1:8787/v1/chat/completions', data=body,
                                 headers={'Content-Type': 'application/json'})
    try:
        d = json.loads(urllib.request.urlopen(req, timeout=120).read().decode())
        return str(d['choices'][0]['message']['content']).strip()
    except Exception as e:
        log({'type': 'aiji-error', 'msg': str(e)[:120]})
        return ''

def persona_bad(t):
    return any(w in t for w in ('对不起', '抱歉', '误会', '客服', '非常理解', '您'))

def persona_clean(t):
    parts = []
    for seg in t.replace(chr(10), '。').split('。'):
        seg = seg.strip()
        if seg and not persona_bad(seg):
            parts.append(seg)
    out = '。'.join(parts).strip()
    return out if out else t

def ensure_conv():
    """回到跟她的会话页；成功返回 True"""
    for _ in range(6):
        ns = texts()
        if any(('发送消息' in n['t']) for n in ns):
            return True
        # 消息 tab（底部）
        mt = [n for n in ns if n['t'] == '消息' and n['y'] > 2000]
        if mt:
            tap(mt[0]['x'] + 30, mt[0]['y'] + 20); time.sleep(2)
        ns = texts()
        rows = [n for n in ns if NAME in n['t'] and n['y'] > 700]
        if rows:
            r = sorted(rows, key=lambda z: z['y'])[0]
            tap(540, r['y'] + 60); time.sleep(2.5)
        else:
            # 可能停在弹层：返回一次
            ops('key', '4'); time.sleep(1.2)
    return False

def recent_incoming(ns):
    out = []
    for n in ns:
        if n['kind'] != 'T':
            continue
        if n['x'] > 300:      # 右侧 = 她自己发的
            continue
        if n['y'] < 300 or n['y'] > 2050:
            continue
        t = n['t'].replace('&#10;', '').replace('&#160;', '').strip()
        if not t or t in NOISE or TIME_RE.match(t) or re.fullmatch(r'[\d\s.]+', t):
            continue
        if NAME in t or '火花' in t or '互相关注' in t:
            continue
        out.append((n['y'], t))
    out.sort()
    return [t for _, t in out]

def send_reply(reply):
    """点输入框 → 打字 → 点发送 → 回读验证"""
    ns = texts()
    box = [n for n in ns if '发送消息' in n['t']]
    if not box:
        return False, 'no-input-box'
    bx, by = box[0]['x'], box[0]['y']
    tap(bx + 40, by + 20); time.sleep(0.8)
    ops('settype', reply)
    time.sleep(1.2)
    chk = texts()
    typed = any(reply[:6] in n['t'] and n['x'] > 200 for n in chk)
    if not typed:
        return False, 'type-fail'
    snd = [n for n in chk if n['kind'] == 'D' and n['t'] in ('发送', '发送，按钮')]
    if snd:
        tap(snd[0]['x'] + 20, snd[0]['y'] + 20)
    else:
        st = [n for n in chk if n['kind'] == 'T' and n['t'] in ('发送',)]
        if not st:
            return False, 'no-send-button'
        tap(st[0]['x'] + 20, st[0]['y'] + 20)
    time.sleep(2)
    after = texts()
    ok = any(reply[:8] in n['t'] for n in after) and not any('发送消息' in n['t'] and reply[:4] in n['t'] for n in after)
    return ok, ('ok' if ok else 'verify-fail')

def once():
    st = load_state()
    if not ensure_conv():
        log({'type': 'nav-fail'})
        return
    ns = texts()
    msgs = recent_incoming(ns)
    if not msgs:
        return
    clean = []
    for t in msgs:
        if t == st.get('last_reply'):
            continue
        if not clean or clean[-1] != t:
            clean.append(t)
    if not clean or clean[-1] == st.get('last_user'):
        return
    user_text = chr(10).join(clean[-4:])
    day = time.strftime('%Y-%m-%d')
    if st.get('day') != day:
        st['day'] = day; st['count'] = 0
    if st.get('count', 0) >= 200:
        log({'type': 'rate-day-cap'}); time.sleep(60); return
    if time.time() - st.get('last_at', 0) < 12:
        log({'type': 'rate-wait'}); time.sleep(3); return
    log({'type': 'user', 'text': user_text})
    reply = ask_aiji(user_text)
    if (not reply) or reply.strip() in ('参数错误', '系统繁忙', '服务异常') or len(reply.strip()) < 2:
        log({'type': 'aiji-bad', 'text': reply[:40]}); time.sleep(5); return
    if persona_bad(reply):
        log({'type': 'persona-clean', 'text': reply[:30]})
        reply = persona_clean(reply)
    log({'type': 'reply', 'text': reply})
    ok, why = send_reply(reply)
    log({'type': 'sent', 'ok': ok, 'why': why, 'text': reply[:30]})
    if ok:
        st.update({'last_reply': reply, 'last_user': user_text,
                   'count': st.get('count', 0) + 1, 'last_at': time.time()})
        save_state(st)

def main():
    loop = '--once' not in sys.argv
    while True:
        if os.path.exists(STOP):
            log({'type': 'stop'}); return
        try:
            once()
        except Exception as e:
            log({'type': 'error', 'msg': str(e)[:200]})
        if not loop:
            return
        time.sleep(1.2)

if __name__ == '__main__':
    main()

