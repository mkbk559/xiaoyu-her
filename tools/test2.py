import os, json, subprocess, time
H='/opt/her'; NODE='/opt/node/bin/node'
def run(args, env=None, tail=900):
    e=dict(os.environ); e.update(env or {})
    r=subprocess.run(args,capture_output=True,text=True,cwd=H,env=e)
    return r.returncode, (r.stdout or '')[-tail:], (r.stderr or '')[-500:]
print('--- 1. 日程单一来源 ---')
c,o,e=run([NODE,'--input-type=module','-e',"const m=await import('/opt/her/her-world.mjs'); console.log('slots',m.SCHEDULE.length); console.log(JSON.stringify(m.currentSlot())); console.log(m.SCHEDULE.map(s=>s.from+'-'+s.to+':'+s.kind+(s.learn?'[learn]':'')).join(' | '))"],tail=1500)
print(o or e)
print('--- 2. plan.mjs ---')
c,o,e=run([NODE,'plan.mjs'],tail=1200); print(o[-800:] or e)
print('--- 3. 真实时间 dry tick（21 点晚上：应 idle）---')
c,o,e=run([NODE,'her-mind.mjs','tick','--dry'],tail=700); print(o[-400:] or e)
m=json.load(open(H+'/her-mind.json'))
for g in m['goals']:
    if g['id'] in ('novel','videos'): g['target']=1
m['today']['did']=[]
json.dump(m,open(H+'/.dry-her-mind.json','w'),ensure_ascii=False,indent=1)
print('--- 4. 伪造 14:00 + 没有可做的目标 → 应选「学」---')
c,o,e=run([NODE,'her-mind.mjs','tick','--dry'],{'HER_FAKE_HOUR':'14'},tail=900)
print(o[-700:] or e)
print('--- 5. 今天已学 3 次（配额满）→ 应 idle ---')
n=time.strftime('%Y-%m-%d %H:00')
m['today']['did']=[{"at":n,"goal":"learn","ok":True,"note":"学了一轮"}]*3
json.dump(m,open(H+'/.dry-her-mind.json','w'),ensure_ascii=False,indent=1)
c,o,e=run([NODE,'her-mind.mjs','tick','--dry'],{'HER_FAKE_HOUR':'14'},tail=700)
print(o[-500:] or e)
print('--- 6. 伪造 21:00（非学习时段）→ 应 idle ---')
m['today']['did']=[]
json.dump(m,open(H+'/.dry-her-mind.json','w'),ensure_ascii=False,indent=1)
c,o,e=run([NODE,'her-mind.mjs','tick','--dry'],{'HER_FAKE_HOUR':'21'},tail=700)
print(o[-400:] or e)
