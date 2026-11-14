#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""她的免疫系统（2026-11-14 自改前提）
- 每 10 分钟：跑固定评测（只读）、查服务/桥、看回归
- 有回归：重启挂掉的服务；若最近一次提交带 selfmod 标记则 git revert；记一条失败经验 + 告警
- 这个文件在她"黑名单"里：她自己不能改它（见 her-selfmod-policy.json）
"""
import json, os, subprocess, time

H = '/opt/her'
EV = '/opt/her-eval'
LOG = '/var/log/her-immune.log'
ALERT = H + '/her-alerts.jsonl'
NOTIFY = H + '/NOTIFY-IMMUNE.txt'
EXP = H + '/her-experience.jsonl'


def log(msg):
    try:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + chr(10))
    except Exception:
        pass


def run(cmd, timeout=180):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None


def main():
    fails = []
    acts = []

    # 1) 固定评测
    run(['/opt/node/bin/node', EV + '/eval.mjs'], timeout=180)
    score = {}
    try:
        score = json.load(open(EV + '/scorecard.json', encoding='utf-8'))
    except Exception:
        fails.append('eval-missing')
    fails += [f for f in (score.get('fail') or []) if f not in fails]

    # 2) 服务健康
    down = []
    for u in ('aiji', 'her-chat'):
        r = run(['systemctl', 'is-active', u], timeout=15)
        if (not r) or (r.stdout or '').strip() != 'active':
            down.append(u)
    if down:
        fails.append('service-down')
        for u in down:
            run(['systemctl', 'restart', u], timeout=120)
            acts.append('restart:' + u)

    # 3) 回归处置：只在最近提交是 selfmod 时自动回滚代码
    if any(f in ('novel', 'persona', 'graph-age', 'graph-nodes', 'bridge') for f in fails):
        r = run(['git', '-C', H, 'log', '-1', '--pretty=%s'], timeout=20)
        subj = ((r.stdout or '').strip() if r else '')
        if 'selfmod' in subj:
            rr = run(['git', '-C', H, 'revert', '--no-edit', 'HEAD'], timeout=180)
            acts.append('git-revert:' + subj[:40])
            try:
                with open(EXP, 'a', encoding='utf-8') as f:
                    f.write(json.dumps({'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'type': 'immune',
                                        'goal': 'selfmod', 'ok': False,
                                        'reason': '自改回归:' + ','.join(fails)}, ensure_ascii=False) + chr(10))
            except Exception:
                pass

    # 4) 告警落盘（沿用她现有的告警文件）
    if fails:
        try:
            with open(ALERT, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'level': 'high',
                                    'code': 'immune', 'message': '回归:' + ','.join(fails),
                                    'action': acts}, ensure_ascii=False) + chr(10))
            with open(NOTIFY, 'w', encoding='utf-8') as f:
                f.write(time.strftime('%Y-%m-%d %H:%M:%S') + ' ' + ','.join(fails) + chr(10))
        except Exception:
            pass

    log(('FAIL ' if fails else 'PASS ') + ','.join(fails) + (' | acts:' + ';'.join(acts) if acts else ''))
    print(json.dumps({'ok': not fails, 'fails': fails, 'acts': acts}, ensure_ascii=False))
    return 0 if not fails else 1


if __name__ == '__main__':
    raise SystemExit(main())
