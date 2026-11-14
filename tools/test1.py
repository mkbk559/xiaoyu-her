import os, json, subprocess, shutil, time
H='/opt/her'
NODE='/opt/node/bin/node'
def run(args, env=None):
    e=dict(os.environ); e.update(env or {})
    r=subprocess.run(args,capture_output=True,text=True,cwd=H,env=e)
    return r.returncode, (r.stdout or '')[-1200:], (r.stderr or '')[-800:]
print('--- 1. 日程来自 plan.mjs（10 段）---')
code,out,err=run([NODE,'--input-type=module','-e',"const m=await import('/opt/her/her-world.mjs'); console.log('slots',m.SCHEDULE.length); console.log(JSON.stringify(m.currentSlot())); console.log(m.SCHEDULE.map(s=>s.from+'-'+s.to+':'+s.kind+(s.learn?'[learn]':'')).join(' | '))"])
print(out or err)
print('--- 2. plan.mjs 打印 ---')
code,out,err=run([NODE,'plan.mjs'])
print(out[-900:] or err)
print('--- 3. dry tick（真实时间 21 点，晚上该 idle）---')
code,out,err=run([NODE,'her-mind.mjs','tick','--dry'])
print(out[-600:] or err)
print('--- 4. dry tick（伪造 14:00，目标都满了 → 应该选“学”）---')
m=json.load(open(H+'/her-mind.json'))
for g in m['goals']:
    g['current']=g['target']
m['today']['did']=[]
json.dump(m,open(H+'/.dry-her-mind.json','w'),ensure_ascii=False,indent=1)
code,out,err=run([NODE,'her-mind.mjs','tick','--dry'],{'HER_FAKE_HOUR':'14'})
print(out[-900:] or err)
print('--- 5. 配额测试（今天已学 3 次 → 不该再选学）---')
n=time.strftime('%Y-%m-%d %H:00')
m['today']['did']=[{"at":n,"goal":"learn","ok":True,"note":"学了一轮"}]*3
json.dump(m,open(H+'/.dry-her-mind.json','w'),ensure_ascii=False,indent=1)
code,out,err=run([NODE,'her-mind.mjs','tick','--dry'],{'HER_FAKE_HOUR':'14'})
print(out[-600:] or err)
