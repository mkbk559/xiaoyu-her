#!/opt/her/.venv/bin/python
# -*- coding: utf-8 -*-
"""phone-look.py —— 控件树 + 截图 + OCR 三方对照（2026-11-14）
原则：任何点击都必须同时被 ①控件树节点 ②截图上 OCR 找到的框 证到；
      两者对不上 → 不点，存证据 + 报错。图标类按钮（"发送"）额外可选视觉确认。

用法：
  python phone-look.py look                 # 只读：树 + OCR + 对照结果
  python phone-look.py plan 发送            # 只读：给一个目标，输出"点不点、点哪里"的判断
  python phone-look.py click 发送 --live    # 真点（默认 dry-run，只打印）
  python phone-look.py verify 发送          # 只读：某文字是否同时出现在树和 OCR 里

证据：每次都会把截图存到 /opt/her/phone-shots/<时间>.png，动作记 phone-actions.jsonl
"""
import json, os, re, subprocess, sys, time, difflib

SERIAL = '127.0.0.1:15557'
SHOTS = '/opt/her/phone-shots'
ACT = '/opt/her/phone-actions.jsonl'
os.makedirs(SHOTS, exist_ok=True)


def sh(*args, timeout=45):
    try:
        r = subprocess.run(list(args), capture_output=True, text=True, timeout=timeout)
        return (r.stdout or '') + (r.stderr or '')
    except Exception as e:
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
    xml = sh('adb', '-s', SERIAL, 'shell', 'uiautomator', 'dump', '/sdcard/_pl.xml') + \
          sh('adb', '-s', SERIAL, 'shell', 'cat', '/sdcard/_pl.xml')
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
        ns.append({'text': t, 'desc': d, 'id': (rid.group(1) if rid else ''),
                   'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2})
    return ns


def ocr_boxes(png):
    out = sh('tesseract', png, 'stdout', '-l', 'chi_sim+eng', '--psm', '11', 'tsv', timeout=90)
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
    # 按行聚合（相邻 y 的框合并，读起来更像一个标签）
    rows.sort(key=lambda r: (r['y1'], r['x1']))
    merged = []
    for r in rows:
        if merged:
            m = merged[-1]
            if abs(r['y1'] - m['y1']) < 18 and r['x1'] - m['x2'] < 40:
                m['t'] = m['t'] + r['t']
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
            out.append({'label': label, 'node': n, 'ocr': best[1], 'text_sim': round(best[2], 2), 'overlap': round(best[3], 2)})
    return out


def perceive():
    png = shot()
    nodes = dump_nodes()
    boxes = ocr_boxes(png) if png else []
    return png, nodes, boxes


def cmd_look():
    png, nodes, boxes = perceive()
    m = match(nodes, boxes)
    print(json.dumps({'shot': png, 'nodes': len(nodes), 'ocr': len(boxes), 'matched': len(m),
                      'matched_sample': [{'label': x['label'], 'node': [x['node']['x1'], x['node']['y1'], x['node']['x2'], x['node']['y2']],
                                          'ocr': [x['ocr']['x1'], x['ocr']['y1'], x['ocr']['x2'], x['ocr']['y2']],
                                          'sim': x['text_sim'], 'ov': x['overlap']} for x in m[:12]]},
                     ensure_ascii=False, indent=1))


def find_target(label):
    png, nodes, boxes = perceive()
    m = match(nodes, boxes)
    hits = [x for x in m if similar(label, x['label']) >= 0.6]
    if not hits:
        return png, None, {'reason': 'no-node-and-ocr-agreement', 'nodes': len(nodes), 'ocr': len(boxes)}
    # 取最靠下/最大的那个（列表里更可能是目标行）
    h = sorted(hits, key=lambda x: (x['node']['y2'] - x['node']['y1']) * (x['node']['x2'] - x['node']['x1']))[-1]
    cx = (max(h['node']['x1'], h['ocr']['x1']) + min(h['node']['x2'], h['ocr']['x2'])) // 2
    cy = (max(h['node']['y1'], h['ocr']['y1']) + min(h['node']['y2'], h['ocr']['y2'])) // 2
    return png, (cx, cy), h


def main():
    args = sys.argv[1:]
    if not args or args[0] == 'look':
        return cmd_look()
    cmd = args[0]
    label = args[1] if len(args) > 1 else ''
    live = '--live' in args
    png, pt, info = find_target(label)
    if pt is None:
        print(json.dumps({'ok': False, 'target': label, 'shot': png, 'detail': info}, ensure_ascii=False, indent=1))
        log_action({'type': 'abort', 'target': label, 'reason': info.get('reason'), 'shot': png})
        return
    rec = {'ok': True, 'target': label, 'shot': png, 'point': pt,
           'node': {'label': info['label'], 'bounds': [info['node'][k] for k in ('x1', 'y1', 'x2', 'y2')],
                    'desc': info['node']['desc'], 'id': info['node']['id']},
           'ocr': {'text': info['ocr']['t'], 'bounds': [info['ocr'][k] for k in ('x1', 'y1', 'x2', 'y2')],
                   'conf': info['ocr']['conf']},
           'text_sim': info['text_sim'], 'overlap': info['overlap'], 'live': live}
    if cmd == 'click' and live:
        sh('adb', '-s', SERIAL, 'shell', 'input', 'tap', str(pt[0]), str(pt[1]))
        rec['clicked'] = True
        time.sleep(1.2)
        _p2, n2, b2 = perceive()
        rec['verify_after'] = any(similar(label, x['text'] or x['desc']) >= 0.6 for x in n2)
        log_action(rec)
    else:
        log_action({'type': 'plan', 'target': label, 'shot': png, 'point': pt})
    print(json.dumps(rec, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
