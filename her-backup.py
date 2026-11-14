#!/usr/bin/env python3
"""她的备份（B 为主：人格/记忆丢了不是数据损失，是她没了）

- 多版本历史：her-soul.json / her-graph.json / aiji.db 每 2 小时一版，保留 60 版（约 5 天）
- 完整性校验：JSON 能解析；关系数/记忆层/图节点/事实数比上一版跌超 30% 就告警
- 每日整包：状态 + 小说 + 知识库 + 聊天记录 打成 tar，保留 7 天
用法：python3 her-backup.py [--daily]
"""
import os, sys, json, time, shutil, sqlite3, tarfile

H = '/opt/her'
BK = H + '/_backup'
AIDB = '/opt/aijiyi/data/aiji.db'
ALERT = H + '/her-alerts.jsonl'
NOTE = H + '/NOTIFY-BACKUP.txt'
TAG = time.strftime('%Y%m%d-%H%M%S')
DAY = time.strftime('%Y-%m-%d')
problems = []
made = []

for d in ['soul', 'graph', 'mind', 'goals', 'aiji', 'daily']:
    os.makedirs(os.path.join(BK, d), exist_ok=True)


def prev_of(d):
    fs = sorted(os.listdir(os.path.join(BK, d)))
    return fs[-1] if fs else None


def soul_counts(p):
    d = json.load(open(p, encoding='utf-8'))
    mem = d.get('memory', {})
    return {
        'relations': len(d.get('relations', {})),
        'desires': len(d.get('desires', [])),
        'episodic': len(mem.get('episodic', [])),
        'semantic': len(mem.get('semantic', [])),
        'relational': len(mem.get('relational', [])),
        'emotional': len(mem.get('emotional', [])),
    }


def graph_counts(p):
    d = json.load(open(p, encoding='utf-8'))
    return {'nodes': len(d.get('nodes', [])), 'edges': len(d.get('edges', []))}


def db_counts(p):
    c = sqlite3.connect('file:' + p + '?mode=ro', uri=True)
    out = {}
    try:
        tabs = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
        for t in tabs:
            try:
                out[t] = c.execute('select count(*) from [%s]' % t).fetchone()[0]
            except Exception:
                pass
    finally:
        c.close()
    return out


def check_drop(kind, cur, old):
    for k, v in cur.items():
        ov = old.get(k, 0)
        if ov > 0 and v < ov * 0.7:
            problems.append('%s.%s 从 %d 掉到 %d' % (kind, k, ov, v))


def load_baseline():
    try:
        return json.load(open(os.path.join(BK, 'baseline.json'), encoding='utf-8'))
    except Exception:
        return {}

def history_peak(kind, counter, days=7):
    out = {}
    cutoff = time.time() - days * 86400
    try:
        fs = os.listdir(os.path.join(BK, kind))
    except Exception:
        return out
    for f in sorted(fs):
        p = os.path.join(BK, kind, f)
        try:
            if os.path.getmtime(p) < cutoff:
                continue
            c = counter(p)
        except Exception:
            continue
        for k, v in c.items():
            if isinstance(v, int) and (k not in out or v > out[k]):
                out[k] = v
    return out

def check_growth(kind, cur, prev_counts, min_delta=5):
    # 2026-11-12 修误报：episodic/emotional 随日常活动自然增长，不做"涨"告警；
    # 只盯 relations/semantic 这类应该稳定的，且门槛提到 50% + 更大绝对量。
    SKIP = {'episodic', 'emotional'}
    for k, v in cur.items():
        if k in SKIP:
            continue
        pv = prev_counts.get(k, 0)
        if not isinstance(pv, int) or pv <= 0:
            continue
        need_delta = max(min_delta, 10 if k == 'semantic' else 3)
        if v > pv * 1.5 and (v - pv) >= need_delta:
            problems.append('%s.%s 单次涨超 50%%（%d -> %d）' % (kind, k, pv, v))

def check_baseline(kind, cur, counter):
    base = load_baseline().get(kind, {})
    for name, ref in (('7天峰值', history_peak(kind, counter)), ('人工基线', base)):
        for k, v in cur.items():
            r = ref.get(k, 0)
            if isinstance(r, int) and r > 0 and v < r * 0.8:
                problems.append('%s.%s 低于%s %d（现在 %d）' % (kind, k, name, r, v))

def backup_json(src, kind, counter):
    name = kind + '-' + TAG + '.json'
    try:
        json.load(open(src, encoding='utf-8'))
    except Exception as e:
        problems.append(kind + ' 无法解析: ' + str(e)[:80])
        return
    cur = counter(src)
    p = prev_of(kind)
    prev_counts = None
    if p:
        try:
            prev_counts = counter(os.path.join(BK, kind, p))
            check_drop(kind, cur, prev_counts)
            # 涨告警只对 soul/graph（mind/goals 存的是 bytes，会随日常写入自然涨）
            if kind in ('soul', 'graph'):
                check_growth(kind, cur, prev_counts)
        except Exception:
            pass
    if kind in ('soul', 'graph'):
        check_baseline(kind, cur, counter)
    shutil.copy2(src, os.path.join(BK, kind, name))
    made.append(kind + '/' + name)
    print('  %-6s %-22s %s' % (kind, name, json.dumps(cur, ensure_ascii=False)))


print('== 备份 ' + TAG + ' ==')
backup_json(H + '/her-soul.json', 'soul', soul_counts)
backup_json(H + '/her-graph.json', 'graph', graph_counts)
backup_json(H + '/her-mind.json', 'mind', lambda p: {'bytes': os.path.getsize(p)})
backup_json(H + '/her-goals.json', 'goals', lambda p: {'bytes': os.path.getsize(p)})

# aiji 事实库：用 sqlite 热备 API（自动处理 WAL）
try:
    dst = os.path.join(BK, 'aiji', 'aiji-' + TAG + '.db')
    src_con = sqlite3.connect('file:' + AIDB + '?mode=ro', uri=True)
    out_con = sqlite3.connect(dst)
    src_con.backup(out_con)
    try: out_con.execute('PRAGMA journal_mode=DELETE')
    except Exception: pass
    out_con.close()
    src_con.close()
    cur = db_counts(dst)
    p = prev_of('aiji')
    if p:
        try:
            prev_db = db_counts(os.path.join(BK, 'aiji', p))
            check_drop('aiji', cur, prev_db)
            check_growth('aiji', cur, prev_db, min_delta=50)
        except Exception:
            pass
    check_baseline('aiji', cur, db_counts)
    total = sum(cur.values())
    made.append('aiji/' + os.path.basename(dst))
    print('  %-6s %-22s tables=%d rows=%d' % ('aiji', os.path.basename(dst), len(cur), total))
except Exception as e:
    problems.append('aiji 备份失败: ' + str(e)[:100])

# 保留策略
def prune(d, keep):
    fs = sorted(os.listdir(os.path.join(BK, d)))
    for f in fs[:-keep]:
        try:
            os.remove(os.path.join(BK, d, f))
        except Exception:
            pass


if '--confirm' in sys.argv:
    base = {'at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'soul': soul_counts(H + '/her-soul.json'),
            'graph': graph_counts(H + '/her-graph.json'),
            'aiji': db_counts(os.path.join(BK, 'aiji', 'aiji-' + TAG + '.db'))}
    with open(os.path.join(BK, 'baseline.json'), 'w', encoding='utf-8') as f:
        json.dump(base, f, ensure_ascii=False, indent=1)
    print('已写入人工基线 baseline.json: ' + json.dumps({k: len(v) if isinstance(v, dict) else v for k, v in base.items()}, ensure_ascii=False))

prune('soul', 60)
prune('graph', 60)
prune('mind', 60)
prune('goals', 60)
prune('aiji', 24)

# 每日整包（含文本类全部；成片不值钱、太大，不打包）
if '--daily' in sys.argv or time.localtime().tm_hour == 0:
    tar = os.path.join(BK, 'daily', 'her-state-' + DAY + '.tar.gz')
    tmp = tar + '.part'
    items = ['her-soul.json', 'her-graph.json', 'her-mind.json', 'her-goals.json',
             'her-contract.json', 'her-arbiter-state.json', 'her-proactive.jsonl',
             'her-reflections.jsonl', 'her-trace.jsonl', 'her-alerts.jsonl',
             'skills.jsonl', 'self-learn.jsonl', 'chats', 'novel/正文', 'knowledge']
    with tarfile.open(tmp, 'w:gz') as t:
        for it in items:
            p = os.path.join(H, it)
            if os.path.exists(p):
                t.add(p, arcname=it)
        if os.path.exists(os.path.join(BK, 'aiji', 'aiji-' + TAG + '.db')):
            t.add(os.path.join(BK, 'aiji', 'aiji-' + TAG + '.db'), arcname='aiji.db')
    os.replace(tmp, tar)
    fs = sorted(os.listdir(os.path.join(BK, 'daily')))
    for f in fs[:-7]:
        try:
            os.remove(os.path.join(BK, 'daily', f))
        except Exception:
            pass
    made.append('daily/' + os.path.basename(tar))
    print('  daily  %-22s %d KB' % (os.path.basename(tar), os.path.getsize(tar) // 1024))

# 告警
if problems:
    line = {'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'level': 'high',
            'code': 'backup-anomaly', 'message': '; '.join(problems), 'action': 'warn'}
    with open(ALERT, 'a', encoding='utf-8') as f:
        f.write(json.dumps(line, ensure_ascii=False) + chr(10))
    with open(NOTE, 'w', encoding='utf-8') as f:
        f.write('备份异常 ' + TAG + chr(10) + chr(10).join(problems) + chr(10))
    try:
        with open(H + '/NOTIFY-FATAL.txt', 'w', encoding='utf-8') as f:
            f.write('[' + TAG + '] backup-anomaly' + chr(10) + '; '.join(problems) + chr(10) + chr(10) +
                    '处理：看 /opt/her/NOTIFY-BACKUP.txt；回滚：/opt/her/_backup/<kind>/ 里挑上一版' + chr(10))
    except Exception:
        pass
    print('!! 告警: ' + '; '.join(problems))
elif os.path.exists(NOTE):
    os.remove(NOTE)
if not problems:
    try:
        fp = H + '/NOTIFY-FATAL.txt'
        if os.path.exists(fp):
            txt = open(fp, encoding='utf-8').read()
            first = txt.split(chr(10))[0] if txt else ''
            if first.startswith('[') and '] backup-anomaly' in first:
                os.remove(fp)
    except Exception:
        pass

print('完成：' + str(len(made)) + ' 项，问题 ' + str(len(problems)) + ' 个')
sys.exit(1 if problems else 0)
