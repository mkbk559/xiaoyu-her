#!/usr/bin/env python3
"""tick 结果检查（原 night-watch 逻辑，2026-11-12 并入 her-watchdog）
有新 tick 就往 /var/log/her-watchdog.log 追加一段摘要。
"""
import json, os, subprocess
H='/opt/her'; LOG='/var/log/her-watchdog.log'
STATE=H+'/.her-tick-last'
def sh(c): return subprocess.run(['bash','-lc',c],capture_output=True,text=True).stdout
try:
    cur=json.load(open(H+'/her-mind.json',encoding='utf-8')).get('at','')
except Exception:
    cur=''
if not cur: raise SystemExit(0)
prev=open(STATE).read().strip() if os.path.exists(STATE) else ''
if cur==prev: raise SystemExit(0)
open(STATE,'w').write(cur)
word=0
try:
    d=H+'/novel/正文'
    for f in os.listdir(d):
        if f.endswith('.md'):
            word+=len(open(d+'/'+f,encoding='utf-8').read().replace(' ','').replace(chr(10),''))
except Exception: pass
lines=['','════ tick 检查 ' + sh('TZ=Asia/Shanghai date "+%Y-%m-%d %H:%M:%S"').strip() + ' ════',
       '内核 at: ' + cur,
       '暂停: ' + ('有' if os.path.exists(H+'/her-paused.json') else '无') + ' | fatal: ' + ('有' if os.path.exists(H+'/NOTIFY-FATAL.txt') else '无'),
       '小说字数: ' + str(word)]
tail=sh('tail -6 /var/log/her-mind.log').splitlines()
lines += ['--- 内核日志尾 ---'] + tail
with open(LOG,'a',encoding='utf-8') as f:
    f.write(chr(10).join(lines)+chr(10))
