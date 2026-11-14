#!/usr/bin/env python3
"""上游按模型拆分：把 her key 的真 token 分成「聊天（aiji）」和「内核（brain）」
用法: python3 her-cost-split.py [--days 7]
数据源(只读): agent2api.requests、brain-usage.jsonl、chat-usage-probe.jsonl
分类依据（来自 aiji.json routes 与 brain.mjs 实配）:
  聊天: auto / glm-5.3-flash*  （aiji 的服务端路由）
  内核: deepseek* / glm-4.6v / raccoon-image / hunyuan-image*（brain 直连与出图）
  pollinations 不进网关，不在此表
"""
import sqlite3, json, os, sys, csv, datetime, collections

H='/opt/her'
DB='/var/lib/agent2api/agent2api.db'
OUT=H+'/_report'; os.makedirs(OUT, exist_ok=True)
DAYS=7
for i,a in enumerate(sys.argv):
    if a=='--days' and i+1<len(sys.argv): DAYS=int(sys.argv[i+1])

def kind(model):
    m=(model or '').lower()
    if m=='auto' or 'glm-5.3' in m or 'sn-glm-5-3' in m:
        return 'chat'
    if 'deepseek' in m or 'glm-4.6v' in m or 'raccoon-image' in m or 'hunyuan-image' in m:
        return 'kernel'
    return 'unknown'

today=datetime.date.today()
days=[(today-datetime.timedelta(days=i)).isoformat() for i in range(DAYS-1,-1,-1)]
c=sqlite3.connect('file:'+DB+'?mode=ro',uri=True)
D="strftime('%Y-%m-%d', ts/1000, 'unixepoch', '+8 hours')"
rows=list(c.execute("select "+D+" d, model, status, coalesce(total_tokens,0), coalesce(prompt_tokens,0), coalesce(completion_tokens,0), coalesce(cache_read_tokens,0) from requests where api_key_name='her'"))
c.close()
agg=collections.defaultdict(lambda: collections.defaultdict(lambda: {'req':0,'ok':0,'tok':0,'prompt':0,'compl':0,'cache':0}))
unk=collections.Counter()
for d,model,status,tok,pr,co,ca in rows:
    if d not in days: continue
    k=kind(model)
    if k=='unknown': unk[model]+=1
    a=agg[d][k]; a['req']+=1; a['tok']+=tok; a['prompt']+=pr; a['compl']+=co; a['cache']+=ca
    if status==200: a['ok']+=1
# 估算账
bn=collections.Counter(); bt=collections.Counter()
if os.path.exists(H+'/brain-usage.jsonl'):
    for l in open(H+'/brain-usage.jsonl',encoding='utf-8'):
        l=l.strip()
        if not l: continue
        try: r=json.loads(l)
        except Exception: continue
        d=str(r.get('at'))[:10]
        if d in days: bn[d]+=1; bt[d]+=(r.get('tokens') or 0)
pn=collections.Counter(); pt=collections.Counter()
if os.path.exists(H+'/chat-usage-probe.jsonl'):
    for l in open(H+'/chat-usage-probe.jsonl',encoding='utf-8'):
        l=l.strip()
        if not l: continue
        try: r=json.loads(l)
        except Exception: continue
        d=str(r.get('at'))[:10]
        if d in days: pn[d]+=1; pt[d]+=(r.get('tokens') or 0)

L=['# 成本拆分（上游真 token 按模型归因）','',
   '_口径（2026-11-12 定案）：上游 agent2api.requests 里 api_key_name=her 的真 token；聊天=auto/glm-5.3*（含 aiji 内部摘要/反思调用，全部计入聊天成本），内核=deepseek*/glm-4.6v/图片；估算账 brain-usage 只作交叉校验，探针只覆盖桥最后一次调用、不能当成本。_','',
   '| 日期 | 聊天 请求 | 聊天 真token | 聊天消息数 | 平均 token/条 | 内核 请求 | 内核 真token | unknown | brain 估算 token | 探针估算 token |',
   '|---|---|---|---|---|---|---|---|---|---|']
for d in days:
    ch=agg[d]['chat']; ke=agg[d]['kernel']; u=agg[d]['unknown']
    umsgs = 0
    cp = H + '/chats/' + d + '.jsonl'
    if os.path.exists(cp):
        for line in open(cp, encoding='utf-8'):
            try:
                r = json.loads(line)
                if str(r.get('qq')) == '2216608312': umsgs += 1
            except Exception:
                pass
    avg = int(ch['tok'] / umsgs) if umsgs else 0
    L.append('| %s | %d | %d | %d | %d | %d | %d | %d | %d | %d |' % (d, ch['req'], ch['tok'], umsgs, avg, ke['req'], ke['tok'], u['req'], bt.get(d,0), pt.get(d,0)))
tot=lambda k:'%d' % sum(agg[d][k]['tok'] for d in days)
L+=['','**窗口合计**：聊天真 token **%s**，内核真 token **%s**，unknown **%s**' % (tot('chat'), tot('kernel'), tot('unknown')),'']
if unk:
    L.append('⚠️ 未知模型（未归类，需补映射）：')
    for m,n in unk.most_common(): L.append('- %s ×%d' % (m,n))
    L.append('')
md=chr(10).join(L)
open(OUT+'/cost-split-'+today.strftime('%Y%m%d')+'.md','w',encoding='utf-8').write(md)
with open(OUT+'/cost-split-'+today.strftime('%Y%m%d')+'.csv','w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f); w.writerow(['day','kind','requests','ok','tokens','prompt_tokens','completion_tokens','cache_read'])
    for d in days:
        for k in ('chat','kernel','unknown'):
            a=agg[d][k]
            if a['req']: w.writerow([d,k,a['req'],a['ok'],a['tok'],a['prompt'],a['compl'],a['cache']])
print(md)
