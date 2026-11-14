#!/usr/bin/env python3
import subprocess, time, os
H='/opt/her'
ADB='/usr/bin/adb'
SERIALS=['127.0.0.1:15557','127.0.0.1:15555']
def sh(*a,timeout=30):
    try: return subprocess.run(list(a),capture_output=True,text=True,timeout=timeout).stdout or ''
    except Exception: return ''
def devices(): return sh(ADB,'devices')
def log(msg):
    line=time.strftime('%Y-%m-%d %H:%M:%S')+' '+msg
    open(H+'/phone-watch.log','a').write(line+chr(10))
def alert(msg):
    log('ALERT '+msg)
    open(H+'/PHONE-DOWN.txt','w').write(time.strftime('%Y-%m-%d %H:%M:%S')+' '+msg+chr(10))
d=devices()
if chr(9)+'device' not in d:
    for s in SERIALS:
        sh(ADB,'connect',s)
    time.sleep(3); d=devices()
if chr(9)+'device' not in d:
    alert('phone adb not reachable: '+(d.replace(chr(10),' ')[:200]))
    os._exit(1)
if os.path.exists(H+'/PHONE-DOWN.txt'): os.remove(H+'/PHONE-DOWN.txt')
out=sh('pgrep','-af','phone-bridge2.py')
if 'phone-bridge2.py' not in out:
    log('bridge not running, restart')
    subprocess.Popen(['nohup',H+'/.venv/bin/python',H+'/phone-bridge2.py'],stdout=open(H+'/phone-bridge.log','a'),stderr=subprocess.STDOUT,start_new_session=True)
log('ok')
