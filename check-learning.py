#!/usr/bin/env python3
"""学习触发检查（阶段 2 验收用，每天 18:10）
读 self-learn.jsonl：今天有没有新增学习记录。没有就写 warn 告警。
"""
import json, os, time, datetime
H='/opt/her'; F=H+'/self-learn.jsonl'; ALERT=H+'/her-alerts.jsonl'; LOG='/var/log/her-learn-check.log'
today=datetime.date.today().isoformat()
n_today=0; total=0; last=''
if os.path.exists(F):
    for l in open(F,encoding='utf-8'):
        l=l.strip()
        if not l: continue
        total+=1
        try: r=json.loads(l)
        except Exception: continue
        at=str(r.get('at',''))[:10]
        if at==today: n_today+=1
        if at>last: last=at
msg='%s 学习记录：今日新增 %d，总 %d，最后 %s' % (today,n_today,total,last)
line='['+time.strftime('%Y-%m-%d %H:%M:%S')+'] '+msg
open(LOG,'a',encoding='utf-8').write(line+chr(10))
print(line)
if n_today==0:
    rec={'at':time.strftime('%Y-%m-%d %H:%M:%S'),'level':'medium','code':'learning-not-triggered','message':'今天 18:10 前没有任何学习记录（self-learn.jsonl 无今日新增）','action':'warn'}
    with open(ALERT,'a',encoding='utf-8') as f: f.write(json.dumps(rec,ensure_ascii=False)+chr(10))
