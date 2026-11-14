#!/usr/bin/env python3
"""聊天 usage 探针统计（只读观察期用）
用法：python3 chat-probe-stats.py
输出：每天调用数、token、prompt/completion 比例、平均时延；比例偏离前 2 日均值 >20% 标红。
"""
import json, os, collections
P = '/opt/her/chat-usage-probe.jsonl'
rows = []
if os.path.exists(P):
    for l in open(P, encoding='utf-8'):
        l = l.strip()
        if l:
            try: rows.append(json.loads(l))
            except Exception: pass
if not rows:
    print('探针还没有数据（等第一条 QQ 聊天）')
    raise SystemExit(0)
day = collections.defaultdict(list)
for r in rows:
    day[str(r.get('at',''))[:10]].append(r)
print('| 日期 | 调用 | total token | prompt/completion 比例 | 平均时延 ms |')
print('|---|---|---|---|---|')
prevs = []
for d in sorted(day):
    rs = day[d]
    tot = sum(int(r.get('tokens') or 0) for r in rs)
    pr = sum(int(r.get('prompt') or 0) for r in rs)
    co = sum(int(r.get('completion') or 0) for r in rs)
    ratio = round(pr / co, 2) if co else None
    ms = round(sum(float(r.get('ms') or 0) for r in rs) / len(rs))
    flag = ''
    if prevs and ratio:
        avg = sum(x for x in prevs) / len(prevs)
        if avg and abs(ratio - avg) / avg > 0.2:
            flag = ' ⚠️比例突变'
    print('| %s | %d | %d | %s | %d%s |' % (d, len(rs), tot, ratio, ms, flag))
    if ratio: prevs.append(ratio)
