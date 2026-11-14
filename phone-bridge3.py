#!/opt/her/.venv/bin/python
# -*- coding: utf-8 -*-
"""大肥鱼 手机桥 v3（2026-11-14）
所有点击都走 phone_look：控件树 + 截图 + OCR/视觉 三方对照，对不上就放弃（绝不盲点）。
  python phone-bridge3.py                 # 默认 dry-run：只读+只计划，不点不發
  python phone-bridge3.py --live          # 真动手
  python phone-bridge3.py --once --live   # 处理一轮就退出
"""
import importlib.util, json, os, re, subprocess, sys, time, urllib.request

HOME = '/opt/her'
PY = HOME + '/.venv/bin/python'
LOG = HOME + '/phone-log.jsonl'
STATE = HOME + '/phone-bridge-state.json'
STOP = HOME + '/PHONE-STOP'
NAME = '霸王辣条丝'
NOISE = {'发送消息', '消息', '在线', '限时日常', '状态设置', '智能助手', '点击查看', '回复',
         '暂时没有更多了', '续火花', '已读', '新关注我的移至互动消息', '首页', '朋友', '我',
         '拍摄，按钮', NAME, NAME + '的头像', NAME + '，按钮', '大肥鱼996的头像', '文本'}
TIME_RE = re.compile(r'^(\d{1,2}:\d{2}|昨天.*|刚刚|\d+\s*天[前后].*)$')

# 载入感知模块
_spec = importlib.util.spec_from_file_location('phone_look', HOME + '/phone_look.py')
pl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pl)


def log(o):
    o['at'] = time.strftime('%Y-%m-%d %H:%M:%S')
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    except Exception:
        pass


def load_state():
    try:
        return json.load(open(STATE, encoding='utf-8'))
    except Exception:
        return {'last_reply': '', 'last_user': '', 'day': '', 'count': 0, 'last_at': 0}


def save_state(s):
    json.dump(s, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)


def ops(*args, timeout=60):
    try:
        r = subprocess.run([PY, HOME + '/phoneops.py'] + list(args), capture_output=True, text=True, timeout=timeout)
        return (r.stdout or '') + (r.stderr or '')
    except Exception:
        return ''


def in_conversation(nodes):
    # 2026-11-14：只认会话输入框（msg_et / 发送消息占位 / 按住说话），
    # 不能认任意 EditText——消息列表顶上有搜索框，会被误判成会话
    for n in nodes:
        s = (n['text'] or '') + (n['desc'] or '')
        if 'msg_et' in (n['id'] or '') or ('发送消息' in s) or ('按住 说话' in s):
            return True
    return False


def click_label(label, ymin=0, live=False, note=''):
    """文本类双证点击；返回 (ok, evidence)"""
    png, nodes, boxes, matched = pl.perceive()
    hits = [x for x in matched if pl.similar(label, x['label']) >= 0.6 and x['node']['y1'] >= ymin]
    if not hits:
        pl.log_action({'type': 'abort', 'target': label, 'reason': 'no-node-ocr-agreement', 'shot': png, 'note': note})
        return False, {'reason': 'no-node-ocr-agreement', 'shot': png}
    h = sorted(hits, key=lambda x: -((x['node']['x2'] - x['node']['x1']) * (x['node']['y2'] - x['node']['y1'])))[0]
    cx = (max(h['node']['x1'], h['ocr']['x1']) + min(h['node']['x2'], h['ocr']['x2'])) // 2
    cy = (max(h['node']['y1'], h['ocr']['y1']) + min(h['node']['y2'], h['ocr']['y2'])) // 2
    ev = {'shot': png, 'point': [cx, cy], 'node': [h['node'][k] for k in ('x1', 'y1', 'x2', 'y2')],
          'ocr': [h['ocr'][k] for k in ('x1', 'y1', 'x2', 'y2')], 'sim': h['text_sim'], 'ov': h['overlap']}
    if live:
        pl.sh('adb', '-s', pl.SERIAL, 'shell', 'input', 'tap', str(cx), str(cy))
        ev['clicked'] = True
    pl.log_action({'type': 'click' if live else 'plan', 'target': label, 'note': note, **ev})
    return True, ev


def click_icon(label, live=False, note=''):
    """图标类：节点 desc + 截图裁剪 + 视觉确认，确认才点"""
    png, nodes, boxes, matched = pl.perceive()
    hits = []
    for _n in nodes:
        _d = (_n['desc'] or '').strip()
        _t = (_n['text'] or '').strip()
        if _d == label or _d == label + '，按钮' or _t == label or _t == label + '按钮':
            hits.append(_n)
    if not hits:
        pl.log_action({'type': 'abort', 'target': label, 'reason': 'no-node', 'shot': png, 'note': note})
        return False, {'reason': 'no-node'}
    n = sorted(hits, key=lambda z: -((z['x2'] - z['x1']) * (z['y2'] - z['y1'])))[0]
    q = '这是安卓抖音聊天界面的一小块截图。这块里是不是「' + label + '」按钮？先答 是/否，再补一句你看到的图标长什么样。'
    v = pl.vision_confirm(png, n, q)
    txt = str(v.get('text', ''))
    ok_v = ('是' in txt) and ('否' not in txt[:3])
    ev = {'shot': png, 'node_bounds': [n[k] for k in ('x1', 'y1', 'x2', 'y2')], 'desc': n['desc'],
          'vision': v, 'vision_ok': ok_v}
    if not ok_v:
        pl.log_action({'type': 'abort', 'target': label, 'reason': 'vision-not-confirmed', 'note': note, **ev})
        return False, ev
    cx, cy = (n['x1'] + n['x2']) // 2, (n['y1'] + n['y2']) // 2
    ev['point'] = [cx, cy]
    if live:
        pl.sh('adb', '-s', pl.SERIAL, 'shell', 'input', 'tap', str(cx), str(cy))
        ev['clicked'] = True
    pl.log_action({'type': 'click' if live else 'plan', 'target': label, 'note': note, **ev})
    return True, ev


def ensure_conversation(live=False):
    for _ in range(4):
        png, nodes, boxes, matched = pl.perceive()
        if in_conversation(nodes):
            return True
        # 先点底部"消息"tab
        hits = [x for x in matched if pl.similar('消息', x['label']) >= 0.6 and x['node']['y1'] > 2000]
        if hits:
            h = hits[0]
            cx = (h['node']['x1'] + h['node']['x2']) // 2
            cy = (h['node']['y1'] + h['node']['y2']) // 2
            if live:
                pl.sh('adb', '-s', pl.SERIAL, 'shell', 'input', 'tap', str(cx), str(cy))
            pl.log_action({'type': 'click' if live else 'plan', 'target': '消息tab', 'note': 'ensure-conv', 'point': [cx, cy]})
            time.sleep(2)
        png, nodes, boxes, matched = pl.perceive()
        rows = [x for x in matched if pl.similar(NAME, x['label']) >= 0.6 and x['node']['y1'] > 700]
        if rows:
            h = sorted(rows, key=lambda x: x['node']['y1'])[0]
            cx = (h['node']['x1'] + h['node']['x2']) // 2
            cy = (h['node']['y1'] + h['node']['y2']) // 2
            if live:
                pl.sh('adb', '-s', pl.SERIAL, 'shell', 'input', 'tap', '540', str(cy))
            pl.log_action({'type': 'click' if live else 'plan', 'target': '会话行', 'note': 'ensure-conv',
                           'point': [540, cy], 'sim': h['text_sim'], 'ov': h['overlap'], 'shot': png})
            time.sleep(2.5)
        else:
            if live:
                pl.sh('adb', '-s', pl.SERIAL, 'shell', 'input', 'keyevent', '4')
                time.sleep(1.2)
    return False


def incoming(nodes):
    out = []
    for n in nodes:
        if not n['text']:
            continue
        # 输入框里的草稿不是"对方消息"
        if 'EditText' in (n.get('class') or '') or 'msg_et' in (n.get('id') or ''):
            continue
        if n['x1'] > 300:
            continue
        if n['y1'] < 300 or n['y1'] > 2050:
            continue
        t = n['text'].replace('&#10;', '').strip()
        if not t or t in NOISE or TIME_RE.match(t) or re.fullmatch(r'[\d\s.]+', t):
            continue
        if ('语音消息' in t) or ('火花' in t) or ('互相关注' in t):
            continue
        out.append((n['y1'], t))
    out.sort()
    return [t for _, t in out]


def type_reply(reply, live=False):
    """确保在会话页 + 输入框焦点 → 输入 → 树+OCR 双验 → 失败走广播兜底 → 还不行就清空放弃"""
    png0, nodes0, _, _ = pl.perceive()
    if not in_conversation(nodes0):
        ensure_conversation(live=live)
        png0, nodes0, _, _ = pl.perceive()
        if not in_conversation(nodes0):
            return False, {'stage': 'not-in-conversation', 'shot': png0}
    okf, evf = pl.ensure_edit_focus(live=live)
    if not okf:
        # 再试一次：先双证点 "发送消息" 占位，再确认焦点
        click_label('发送消息', ymin=700, live=live, note='focus-input')
        okf, evf2 = pl.ensure_edit_focus(live=live)
        evf = {'first': evf, 'retry': evf2}
    if not okf:
        return False, {'stage': 'focus-fail', 'ev': evf}
    if not live:
        return True, {'planned': 'set_text', 'focus': evf}
    r = pl.set_text(reply)
    time.sleep(0.8)
    png = pl.shot()
    ev = {'set_text': r, 'shot': png}
    if not r.get('ok'):
        pl.input_text_adb(reply)
        time.sleep(1.2)
        r2 = pl.set_text(reply)  # 兜底后再回读一次
        ev.update({'fallback': 'adb-broadcast', 'retry': r2})
        if not r2.get('ok'):
            pl.clear_input()
            pl.log_action({'type': 'abort', 'target': 'type', 'reason': 'typed-not-visible', 'note': 'type_reply', **ev})
            return False, ev
    return True, ev


def send(live=False):
    if not live:
        return True, {'planned': 'click_send'}
    r = pl.click_send()
    pl.log_action({'type': 'click' if r.get('ok') else 'abort', 'target': '发送', 'note': 'send', **r})
    return bool(r.get('ok')), r


def once(live=False):
    st = load_state()
    if not ensure_conversation(live=live):
        log({'type': 'nav-fail', 'live': live})
        return
    png, nodes, boxes, matched = pl.perceive()
    msgs = incoming(nodes)
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
    log({'type': 'user', 'text': user_text, 'live': live})
    if not live:
        ok1, ev1 = type_reply('（dry-run 不输入）', live=False)
        ok2, ev2 = send(live=False)
        log({'type': 'dry-plan', 'focus_ok': ok1, 'send_ok': ok2, 'ev': {'focus': ev1, 'send': ev2}})
        return
    day = time.strftime('%Y-%m-%d')
    if st.get('day') != day:
        st['day'] = day
        st['count'] = 0
    if st.get('count', 0) >= 200:
        log({'type': 'rate-day-cap'})
        return
    if time.time() - st.get('last_at', 0) < 12:
        log({'type': 'rate-wait'})
        return
    for w in ('参数错误', '系统繁忙', '服务异常'):
        pass
    body = json.dumps({'model': 'aiji', 'user': 'desktop:dafeiyu',
                       'messages': [{'role': 'user', 'content': user_text[:1200]}], 'max_tokens': 200}).encode()
    req = urllib.request.Request('http://127.0.0.1:8787/v1/chat/completions', data=body,
                                 headers={'Content-Type': 'application/json'})
    try:
        reply = json.loads(urllib.request.urlopen(req, timeout=120).read().decode())['choices'][0]['message']['content'].strip()
    except Exception as e:
        log({'type': 'aiji-error', 'msg': str(e)[:100]})
        return
    if (not reply) or reply in ('参数错误', '系统繁忙', '服务异常'):
        log({'type': 'aiji-bad', 'text': reply[:40]})
        return
    for w in ('对不起', '抱歉', '误会', '客服', '非常理解', '您'):
        if w in reply:
            log({'type': 'persona-clean', 'text': reply[:30], 'word': w})
            reply = reply.replace(w, '')
    # 她别把你的抖音昵称当称呼
    reply = reply.replace(NAME, '你')
    log({'type': 'reply', 'text': reply})
    ok, ev = type_reply(reply, live=True)
    if not ok:
        log({'type': 'type-fail', 'ev': ev})
        return
    ok2, ev2 = send(live=True)
    log({'type': 'sent', 'ok': ok2, 'ev': ev2})
    if ok2:
        st.update({'last_reply': reply, 'last_user': user_text, 'count': st.get('count', 0) + 1, 'last_at': time.time()})
        save_state(st)


def main():
    live = '--live' in sys.argv
    loop = '--once' not in sys.argv
    while True:
        if os.path.exists(STOP):
            log({'type': 'stop'})
            return
        try:
            once(live=live)
        except Exception as e:
            log({'type': 'error', 'msg': str(e)[:200]})
        if not loop:
            return
        time.sleep(1.5)


if __name__ == '__main__':
    main()

