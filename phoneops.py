#!/usr/bin/env python3
"""手机通用工具层（云侧调用）：app / 读屏 / 点 / 打字 / 滑动 / 按键 / 截图 / 通知"""
import argparse, base64, json, os, re, subprocess, sys, time
SERIAL = os.environ.get('PHONE_SERIAL', '127.0.0.1:15557')
CANDIDATES = [SERIAL, '127.0.0.1:15557', '127.0.0.1:15555']
ADB = '/usr/bin/adb'
def adb(*args, timeout=30):
    try:
        return subprocess.run([ADB, '-s', SERIAL] + list(args), capture_output=True, text=True, timeout=timeout).stdout or ''
    except Exception:
        return ''
def key(t):
    b64 = base64.b64encode(t.encode()).decode()
    adb('shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b64)
    time.sleep(0.5)
def enter(): adb('shell', 'input', 'keyevent', '66')
def connect():
    import uiautomator2 as u2
    err = None
    for cand in CANDIDATES:
        try:
            return u2.connect(cand)
        except Exception as e:
            err = e
    raise err
def dump_xml(d):
    return d.dump_hierarchy()
def nodes(xml):
    out = []
    for m in re.finditer(r'<node[^>]*?/>', xml):
        s = m.group(0)
        g = lambda k: (re.search(k + r'="([^"]*)"', s) or [None, ''])[1]
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', s)
        if not b: continue
        x1, y1, x2, y2 = map(int, b.groups())
        out.append({'text': g('text'), 'desc': g('content-desc'), 'id': g('resource-id'),
                    'class': g('class'), 'clickable': g('clickable') == 'true',
                    'bounds': (x1, y1, x2, y2), 'cx': (x1 + x2) // 2, 'cy': (y1 + y2) // 2})
    return out
def find(ns, text=None, desc=None, rid=None, contains=False):
    for n in ns:
        if text is not None:
            ok = (text in n['text']) if contains else (n['text'] == text)
            if ok: return n
        if desc is not None and n['desc'] == desc: return n
        if rid is not None and n['id'].endswith(rid): return n
    return None
def tap_node(d, n): d.click(n['cx'], n['cy'])
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd')
    ap.add_argument('args', nargs='*')
    a = ap.parse_args()
    c = a.cmd
    d = connect()
    if c == 'current':
        print(json.dumps(d.app_current(), ensure_ascii=False)); return
    if c == 'start':
        d.app_start(a.args[0]); time.sleep(3); print('started', a.args[0]); return
    if c == 'stop':
        d.app_stop(a.args[0]); print('stopped', a.args[0]); return
    if c == 'apps':
        print(json.dumps(d.app_list(), ensure_ascii=False)); return
    if c in ('texts', 'dump'):
        xml = dump_xml(d); ns = nodes(xml)
        if c == 'texts':
            for n in ns:
                if n['text'] or n['desc']:
                    print(('T' if n['text'] else 'D'), n['text'] or n['desc'], '|', n['cx'], n['cy'])
        else:
            print(xml)
        return
    if c == 'tap-text':
        xml = dump_xml(d); n = find(nodes(xml), text=' '.join(a.args), contains=True)
        print('not found' if not n else 'tap ' + str(n['cx']) + ',' + str(n['cy']))
        if n: tap_node(d, n)
        return
    if c == 'tap-desc':
        xml = dump_xml(d); n = find(nodes(xml), desc=' '.join(a.args))
        print('not found' if not n else 'tap ' + str(n['cx']) + ',' + str(n['cy']))
        if n: tap_node(d, n)
        return
    if c == 'tap':
        d.click(int(a.args[0]), int(a.args[1])); print('tapped'); return
    if c == 'swipe':
        d.swipe(*[int(v) for v in a.args[:4]], 0.3); print('swiped'); return
    if c == 'key':
        adb('shell', 'input', 'keyevent', a.args[0]); print('key', a.args[0]); return
    if c in ('type','settype'):
        ime_was = adb('shell', 'settings', 'get', 'secure', 'default_input_method').strip()
        adb('shell', 'ime', 'set', 'com.android.adbkeyboard/.AdbIME'); time.sleep(0.5)
        key(' '.join(a.args))
        if c == 'type': enter()
        time.sleep(0.5)
        if ime_was and 'adbkeyboard' not in ime_was:
            adb('shell', 'ime', 'set', ime_was)
        print('typed', 'with-enter' if c == 'type' else 'no-enter'); return
    if c == 'shot':
        path = a.args[0] if a.args else '/opt/her/phone-shot.png'
        try:
            d.screenshot(path); print(path); return
        except Exception as e:
            adb('shell', 'screencap', '-p', '/sdcard/phone-shot.png')
            adb('pull', '/sdcard/phone-shot.png', path); print(path); return
    if c == 'notify':
        print(adb('shell', 'dumpsys', 'notification', '--noredact')[:4000]); return
    if c == 'wait-text':
        target = a.args[0]; timeout = float(a.args[1]) if len(a.args) > 1 else 20
        end = time.time() + timeout
        while time.time() < end:
            xml = dump_xml(d)
            if target in xml: print('found'); return
            time.sleep(1)
        print('timeout'); sys.exit(1)
    print('unknown cmd'); sys.exit(2)
if __name__ == '__main__':
    main()
