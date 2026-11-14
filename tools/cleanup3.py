import os, shutil, subprocess, json, time
H='/opt/her'
NL=chr(10)
TOOLS=H+'/_tools'; ARCH=H+'/_archive/20261111-cleanup'
os.makedirs(TOOLS,exist_ok=True); os.makedirs(ARCH,exist_ok=True)
moved=[]
for f in sorted(os.listdir(H)):
    if f.endswith('.py') and f!='her-world-news.py':
        shutil.move(H+'/'+f, TOOLS+'/'+f); moved.append(f)
for f in sorted(os.listdir(H)):
    if f.startswith('.dry-') or '.bak' in f or f in ('NOTIFY-QQ-DOWN.txt','RUN-START.txt'):
        shutil.move(H+'/'+f, ARCH+'/'+f); moved.append(f)
print('moved', len(moved))
print(' _tools:', len(os.listdir(TOOLS)), 'files')
print(' _archive/20261111-cleanup:', len(os.listdir(ARCH)), 'files')
# cron: 删掉坏的 chrome-guard 行
r=subprocess.run(['crontab','-l'],capture_output=True,text=True)
cur=[l for l in r.stdout.splitlines() if l.strip()]
new=[l for l in cur if 'chrome-guard' not in l]
open('/tmp/cron.new','w').write(NL.join(new)+NL)
subprocess.run(['crontab','/tmp/cron.new'],check=True)
print('CRON NOW:'); print(subprocess.run(['crontab','-l'],capture_output=True,text=True).stdout)
# 状态
print('kernel at:', json.load(open(H+'/her-mind.json')).get('at'))
log=open('/var/log/her-mind.log',encoding='utf-8',errors='ignore').read().splitlines()
print('mind log tail:', NL.join(log[-4:]))
print('files now:', len(os.listdir(H)))
