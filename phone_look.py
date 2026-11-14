#!/opt/her/.venv/bin/python
# -*- coding: utf-8 -*-
"""phone_look.py —— 控件树 + 截图 + OCR/视觉 三方对照（2026-11-14）
规则（硬约束）：
  文本类目标：控件树节点 与 截图OCR框 必须互相印证（文字相似≥0.5 且 框重叠≥45%），
             点两框交集的中心。对不上 → 不点。
  图标类目标：控件树里按 content-desc 找到节点 → 截图上按该节点框裁图 → 视觉模型确认
             （glm-4.6v）→ 确认才点。对不上/没确认 → 不点。
  每次动作存截图 + 写 phone-actions.jsonl。

用法：
  python phone_look.py look
  python phone_look.py plan  文本
  python phone_look.py click 文本 --live            # 文本类：双证
  python phone_look.py icon  文本 --vision --live    # 图标类：desc + 视觉确认
"""
import base64, json, os, re, subprocess, sys, time, difflib

SERIAL = '127.0.0.1:15557'
SHOTS = '/opt/her/phone-shots'
CROPS = '/opt/her/phone-crops'
ACT = '/opt/her/phone-actions.jsonl'
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(CROPS, exist_ok=True)


def sh(*args, timeout=60):
    try:
        r = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)
        return (r.stdout or '') + (r.stderr or '')
    except Exception:
        return ''


def log_action(o):
    o['at'] = time.strftime('%Y-%m-%d %H:%M:%S')
    try:
        with open(ACT, 'a', encoding='utf-8') as f:
            f.write(json.dumps(o, ensure_ascii=False) + '\n')
    except Exception:
        pass


def shot(path=None):
    path = path or (SHOTS + '/' + time.strftime('%Y%m%d-%H%M%S') + '.png')
    sh('adb', '-s', SERIAL, 'shell', 'screencap', '-p', '/sdcard/_pl.png')
    sh('adb', '-s', SERIAL, 'pull', '/sdcard/_pl.png', path)
    return path if os.path.exists(path) else None


def dump_nodes():
    sh('adb', '-s', SERIAL, 'shell', 'uiautomator', 'dump', '/sdcard/_pl.xml')
    xml = sh('adb', '-s', SERIAL, 'shell', 'cat', '/sdcard/_pl.xml')
    ns = []
    for m in re.finditer(r'<node[^>]*>', xml):
        tag = m.group(0)
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', tag)
        if not b:
            continue
        x1, y1, x2, y2 = [int(b.group(i)) for i in range(1, 5)]
        if x2 - x1 < 8 or y2 - y1 < 8:
            continue
        t = re.search(r'text="([^"]*)"', tag)
        d = re.search(r'content-desc="([^"]*)"', tag)
        rid = re.search(r'resource-id="([^"]*)"', tag)
        t = (t.group(1) if t else '').strip()
        d = (d.group(1) if d else '').strip()
        if not t and not d:
            continue
        cls = re.search(r'class="([^"]*)"', tag)
        foc = re.search(r'focused="([^"]*)"', tag)
        ns.append({'text': t, 'desc': d, 'id': (rid.group(1) if rid else ''),
                   'class': (cls.group(1) if cls else ''),
                   'focused': (foc.group(1) == 'true' if foc else False),
                   'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2})
    return ns


def ocr_boxes(png):
    out = sh('tesseract', png, 'stdout', '-l', 'chi_sim+eng', '--psm', '11', 'tsv', timeout=120)
    rows = []
    for line in out.splitlines():
        p = line.split('\t')
        if len(p) < 12 or p[0] != '5':
            continue
        try:
            left, top, w, h, conf = int(p[6]), int(p[7]), int(p[8]), int(p[9]), float(p[10])
        except Exception:
            continue
        txt = p[11].strip()
        if not txt or conf < 35:
            continue
        rows.append({'t': txt, 'x1': left, 'y1': top, 'x2': left + w, 'y2': top + h, 'conf': conf})
    rows.sort(key=lambda r: (r['y1'], r['x1']))
    merged = []
    for r in rows:
        if merged:
            m = merged[-1]
            if abs(r['y1'] - m['y1']) < 18 and r['x1'] - m['x2'] < 40:
                m['t'] += r['t']
                m['x1'] = min(m['x1'], r['x1'])
                m['y1'] = min(m['y1'], r['y1'])
                m['x2'] = max(m['x2'], r['x2'])
                m['y2'] = max(m['y2'], r['y2'])
                m['conf'] = max(m['conf'], r['conf'])
                continue
        merged.append(dict(r))
    return merged


def overlap(a, b):
    ix = max(0, min(a['x2'], b['x2']) - max(a['x1'], b['x1']))
    iy = max(0, min(a['y2'], b['y2']) - max(a['y1'], b['y1']))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    amin = (a['x2'] - a['x1']) * (a['y2'] - a['y1'])
    bmin = (b['x2'] - b['x1']) * (b['y2'] - b['y1'])
    return inter / max(1, min(amin, bmin))


def norm(s):
    return re.sub(r'[\s。，、！？,.!?·…—\-_:：""''（）()\[\]【】]', '', s or '')


def similar(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def match(nodes, boxes):
    out = []
    for n in nodes:
        label = n['text'] or n['desc']
        if not label:
            continue
        best = None
        for b in boxes:
            s = similar(label, b['t'])
            ov = overlap(n, b)
            if s >= 0.5 and ov >= 0.45:
                score = s * 0.6 + ov * 0.4
                if not best or score > best[0]:
                    best = (score, b, s, ov)
        if best:
            out.append({'label': label, 'node': n, 'ocr': best[1],
                        'text_sim': round(best[2], 2), 'overlap': round(best[3], 2)})
    return out


def perceive():
    png = shot()
    nodes = dump_nodes()
    boxes = ocr_boxes(png) if png else []
    return png, nodes, boxes, match(nodes, boxes)


def crop(png, box, tag='crop'):
    try:
        from PIL import Image
        im = Image.open(png)
        c = im.crop((max(0, box['x1'] - 4), max(0, box['y1'] - 4),
                     min(im.width, box['x2'] + 4), min(im.height, box['y2'] + 4)))
        out = CROPS + '/' + tag + '-' + time.strftime('%H%M%S') + '.png'
        c.save(out)
        return out
    except Exception:
        return None


def vision_confirm(png, box, question):
    # 裁大一点（输入条附近整块），视觉模型对小图标容易返回空
    big = {'x1': max(0, box['x1'] - 80), 'y1': max(0, box['y1'] - 40),
           'x2': min(2000, box['x2'] + 80), 'y2': min(2600, box['y2'] + 40)}
    cp = crop(png, big, 'v')
    if not cp:
        return {'ok': False, 'text': 'crop-fail'}
    try:
        b64 = base64.b64encode(open(cp, 'rb').read()).decode()
        open('/tmp/_pl_crop.b64', 'w').write(b64)
    except Exception as e:
        return {'ok': False, 'text': 'b64-fail:' + str(e)[:40]}
    r = {'ok': False, 'text': ''}
    for _try in range(4):
        code = ("const fs=require('fs');const b=fs.readFileSync('/tmp/_pl_crop.b64','utf8');"
                "import('/opt/her/brain.mjs').then(m=>m.see(b," + json.dumps(question)
                + ",{maxTokens:120})).then(r=>console.log(JSON.stringify(r)))"
                ".catch(e=>console.log(JSON.stringify({ok:false,err:String(e).slice(0,80)})))")
        out = sh('/opt/node/bin/node', '-e', code, timeout=120)
        try:
            r = json.loads(out.strip().splitlines()[-1])
        except Exception:
            r = {'ok': False, 'text': out[:120]}
        if str(r.get('text', '')).strip():
            break
        time.sleep(2)
    r['crop'] = cp
    return r
def find_text_target(label):
    png, nodes, boxes, m = perceive()
    hits = [x for x in m if similar(label, x['label']) >= 0.6]
    if not hits:
        return png, None, {'reason': 'no-node-ocr-agreement', 'nodes': len(nodes), 'ocr': len(boxes)}
    h = sorted(hits, key=lambda x: (x['node']['y2'] - x['node']['y1']) * (x['node']['x2'] - x['node']['x1']))[-1]
    cx = (max(h['node']['x1'], h['ocr']['x1']) + min(h['node']['x2'], h['ocr']['x2'])) // 2
    cy = (max(h['node']['y1'], h['ocr']['y1']) + min(h['node']['y2'], h['ocr']['y2'])) // 2
    return png, (cx, cy), h


def find_icon_target(label):
    png, nodes, boxes, m = perceive()
    hits = [n for n in nodes if label == n['desc'] or label in n['desc'] or label == n['text']]
    if not hits:
        return png, None, {'reason': 'no-node', 'nodes': len(nodes)}
    n = sorted(hits, key=lambda z: -((z['x2'] - z['x1']) * (z['y2'] - z['y1'])))[0]
    cx, cy = (n['x1'] + n['x2']) // 2, (n['y1'] + n['y2']) // 2
    return png, (cx, cy), n


def do_click(png, pt):
    sh('adb', '-s', SERIAL, 'shell', 'input', 'tap', str(pt[0]), str(pt[1]))


def main():
    args = sys.argv[1:]
    if not args or args[0] == 'look':
        png, nodes, boxes, m = perceive()
        print(json.dumps({'shot': png, 'nodes': len(nodes), 'ocr': len(boxes), 'matched': len(m),
                          'sample': [{'label': x['label'], 'node': [x['node'][k] for k in ('x1', 'y1', 'x2', 'y2')],
                                      'ocr': [x['ocr'][k] for k in ('x1', 'y1', 'x2', 'y2')],
                                      'sim': x['text_sim'], 'ov': x['overlap']} for x in m[:15]]},
                         ensure_ascii=False, indent=1))
        return
    cmd = args[0]
    label = args[1] if len(args) > 1 else ''
    live = '--live' in args
    use_vision = '--vision' in args

    if cmd == 'icon':
        png, pt, info = find_icon_target(label)
        if pt is None:
            print(json.dumps({'ok': False, 'target': label, 'shot': png, 'detail': info}, ensure_ascii=False, indent=1))
            log_action({'type': 'abort', 'target': label, 'reason': info.get('reason'), 'shot': png})
            return
        rec = {'ok': True, 'target': label, 'shot': png, 'point': pt,
               'node': {'label': info['text'] or info['desc'], 'desc': info['desc'], 'id': info['id'],
                        'bounds': [info[k] for k in ('x1', 'y1', 'x2', 'y2')]}}
        if use_vision:
            q = '这是一张安卓截图里裁出来的一小块。请只回答：这块里是不是「' + label + '」按钮？先答 是/否，再补一句你看到的字或图标。'
            v = vision_confirm(png, info, q)
            rec['vision'] = v
            yes = ('是' in str(v.get('text', ''))) and ('否' not in str(v.get('text', ''))[:2])
            rec['vision_ok'] = yes
            if not yes:
                rec['ok'] = False
                rec['reason'] = 'vision-not-confirmed'
        if cmd == 'icon' and live and rec.get('ok'):
            do_click(png, pt)
            rec['clicked'] = True
            time.sleep(1.2)
            _p, n2, _b, _m = perceive()
            rec['after_shot'] = _p
            rec['after_has_text'] = any(similar(label, x['text'] or x['desc']) >= 0.6 for x in n2)
        log_action(rec)
        print(json.dumps(rec, ensure_ascii=False, indent=1))
        return

    # 文本类
    png, pt, info = find_text_target(label)
    if pt is None:
        print(json.dumps({'ok': False, 'target': label, 'shot': png, 'detail': info}, ensure_ascii=False, indent=1))
        log_action({'type': 'abort', 'target': label, 'reason': info.get('reason'), 'shot': png})
        return
    rec = {'ok': True, 'target': label, 'shot': png, 'point': pt,
           'node': {'label': info['label'], 'bounds': [info['node'][k] for k in ('x1', 'y1', 'x2', 'y2')]},
           'ocr': {'text': info['ocr']['t'], 'bounds': [info['ocr'][k] for k in ('x1', 'y1', 'x2', 'y2')],
                   'conf': info['ocr']['conf']},
           'text_sim': info['text_sim'], 'overlap': info['overlap'], 'live': live}
    if cmd == 'click' and live:
        do_click(png, pt)
        rec['clicked'] = True
        time.sleep(1.2)
        _p, n2, _b, _m = perceive()
        rec['after_shot'] = _p
        rec['after_has_text'] = any(similar(label, x['text'] or x['desc']) >= 0.6 for x in n2)
    log_action({'type': 'plan' if not rec.get('clicked') else 'click', 'target': label,
                'shot': png, 'point': pt, 'sim': info['text_sim'], 'ov': info['overlap']})
    print(json.dumps(rec, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()


def find_edits(nodes):
    msget = []
    other = []
    for n in nodes:
        c = n.get('class', '') or ''
        i = n.get('id', '') or ''
        if 'msg_et' in i:
            msget.append(n)
        elif 'EditText' in c:
            other.append(n)
    return msget + other


def ensure_edit_focus(live=False):
    """确保输入框有焦点：优先 EditText，其次点 '发送消息' 占位。返回 (ok, evidence)"""
    png, nodes, boxes, matched = perceive()
    eds = find_edits(nodes)
    if any(n.get('focused') for n in eds):
        return True, {'how': 'already-focused', 'shot': png}
    target = None
    if eds:
        target = eds[0]
    else:
        hits = [x for x in matched if '发送消息' in x['label']]
        if hits:
            target = hits[0]['node']
    if not target:
        return False, {'reason': 'no-edittext-and-no-placeholder', 'shot': png}
    cx = (target['x1'] + target['x2']) // 2
    cy = (target['y1'] + target['y2']) // 2
    if live:
        sh('adb', '-s', SERIAL, 'shell', 'input', 'tap', str(cx), str(cy))
    time.sleep(1.2)
    png2, nodes2, boxes2, m2 = perceive()
    eds2 = find_edits(nodes2)
    ok = any(n.get('focused') for n in eds2)
    return ok, {'how': 'click', 'point': [cx, cy], 'shot': png, 'after_shot': png2,
                'edits': len(eds2), 'focused': ok}


def set_text(text):
    """走 accessibility 直接改 EditText；写完用 u2 自己回读确认（uiautomator dump 会滞后）"""
    try:
        import uiautomator2 as u2
    except Exception as e:
        return {'ok': False, 'err': 'no-u2:' + str(e)[:60]}
    try:
        d = u2.connect(SERIAL)
        el = d(className='android.widget.EditText')
        if el.count == 0:
            return {'ok': False, 'err': 'no-edittext'}
        e = el[0]
        e.set_text(text)
        time.sleep(0.9)
        got = ''
        try:
            got = e.get_text() or ''
        except Exception:
            pass
        return {'ok': got.strip() == text.strip(), 'count': el.count, 'text_after': got[:60],
                'id': (e.info or {}).get('resourceName')}
    except Exception as e:
        return {'ok': False, 'err': str(e)[:120]}


def send_button():
    """用无障碍找发送按钮，再用截图+视觉确认（双证）"""
    try:
        import uiautomator2 as u2
    except Exception as e:
        return {'ok': False, 'reason': 'no-u2:' + str(e)[:40]}
    d = u2.connect(SERIAL)
    el = None
    for sel in (d(description='发送'), d(descriptionContains='发送'), d(text='发送')):
        try:
            if sel.exists:
                el = sel
                break
        except Exception:
            continue
    if el is None:
        return {'ok': False, 'reason': 'no-send-node'}
    try:
        info = el.info or {}
        b = info.get('bounds') or {}
        box = {'x1': b.get('left'), 'y1': b.get('top'), 'x2': b.get('right'), 'y2': b.get('bottom')}
    except Exception:
        return {'ok': False, 'reason': 'no-bounds'}
    png = shot()
    v = vision_confirm(png, box, '这是抖音聊天界面的「发送」按钮吗？先回答 是 或 否，再补一句你看到的图标。')
    txt = str(v.get('text', ''))
    ok_v = ('是' in txt) and ('否' not in txt[:3])
    return {'ok': ok_v, 'box': box, 'desc': (info.get('contentDescription') or ''), 'vision': v, 'shot': png}


def click_send():
    r = send_button()
    if not r.get('ok'):
        return r
    b = r['box']
    cx = (b['x1'] + b['x2']) // 2
    cy = (b['y1'] + b['y2']) // 2
    sh('adb', '-s', SERIAL, 'shell', 'input', 'tap', str(cx), str(cy))
    time.sleep(1.6)
    r['point'] = [cx, cy]
    return r


def input_text_adb(text):
    """兜底：切 ADBKeyboard 用广播塞字"""
    import base64
    sh('adb', '-s', SERIAL, 'shell', 'ime', 'set', 'com.android.adbkeyboard/.AdbIME')
    time.sleep(0.8)
    b = base64.b64encode(text.encode()).decode()
    sh('adb', '-s', SERIAL, 'shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b)
    time.sleep(1.5)
    return {'ok': True}


def clear_input():
    for _ in range(4):
        sh('adb', '-s', SERIAL, 'shell', 'input', 'keyevent', '67')
    sh('adb', '-s', SERIAL, 'shell', 'ime', 'set', 'com.baidu.input_oppo/.ImeService')
    return {'ok': True}
