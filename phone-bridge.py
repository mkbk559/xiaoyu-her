import subprocess, time, json, os, re, base64, urllib.request
HOME='/opt/her'; ADB='/usr/bin/adb'; SERIAL=os.environ.get('PHONE_SERIAL','127.0.0.1:15557')
LOG=HOME+'/phone-log.jsonl'; STATE=HOME+'/phone-bridge-state.json'; STOP=HOME+'/PHONE-STOP'
AWEME='com.ss.android.ugc.aweme'
SKIP={'回复','暂时没有更多了','新关注我的移至互动消息','更多聊天玩法已收至输入框旁的玩法面板内 去看看','点击查看','续火花','当天已互聊，为你恢复 3 天火花','已读','装扮','状态设置','在线','已读','限时日常','智能助手','消息','发送'}
SKIP |= {'霸王辣条丝', '限时日常', '状态设置', '在线', '智能助手', '新关注我的移至互动消息', '火花'}
TIME_RE=re.compile(r'^(\d{1,2}:\d{2}|昨天.*|刚刚|\d+ ?天后.*|\d+ ?天前.*)$')
def log(o):
    o['at']=time.strftime('%Y-%m-%d %H:%M:%S')
    with open(LOG,'a',encoding='utf-8') as f: f.write(json.dumps(o,ensure_ascii=False)+chr(10))
def adb(*a,timeout=40):
    try: return subprocess.run([ADB,'-s',SERIAL]+list(a),capture_output=True,text=True,timeout=timeout).stdout or ''
    except Exception: return ''
def load_state():
    try: return json.load(open(STATE))
    except Exception: return {'last_reply':'','last_user':'','day':'','count':0,'last_at':0}
def save_state(s): json.dump(s,open(STATE,'w',encoding='utf-8'),ensure_ascii=False)
def ask_aiji(text):
    # 2026-11-13: aiji 见到这些词会复读自己的报错，入口统一换成白话
    for _w in ('参数错误','系统繁忙','服务异常'):
        text=text.replace(_w,'那个报错')
    payload=json.dumps({'model':'aiji','user':'desktop:dafeiyu','messages':[{'role':'user','content':text}],'max_tokens':200}).encode()
    req=urllib.request.Request('http://127.0.0.1:8787/v1/chat/completions',data=payload,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=120) as r:
            return json.loads(r.read())['choices'][0]['message']['content'].strip()
    except Exception as e:
        log({'type':'aiji-error','msg':str(e)[:200]}); return ''
def parse(xml):
    msgs=[]; nodes=[]
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',xml):
        t=m.group(1); x1,y1,x2,y2=[int(m.group(i)) for i in (2,3,4,5)]
        nodes.append((t,x1,y1,x2,y2))
    for t,x1,y1,x2,y2 in nodes:
        t=t.strip().replace('&#10;','').replace('&#9;','').replace('&#160;','').strip()  # 2026-11-13: 清 XML 实体+
        if not t or y1<300 or y1>2050: continue
        if t in SKIP or TIME_RE.match(t): continue
        if re.fullmatch(r'[\d\s]+',t): continue
        if '火花' in t or '私信接收范围' in t or '互相关注' in t: continue
        if (x1+x2)//2 >= 520: continue  # 2026-11-13: 只取左侧对方气泡（右侧是她自己）  # 2026-11-13: 右侧是她自己发的，不算"用户消息"
        msgs.append((y1,t))
    msgs.sort(); return msgs,nodes
def center_of(nodes,label):
    for t,x1,y1,x2,y2 in nodes:
        if t==label: return ((x1+x2)//2,(y1+y2)//2)
    return None
import uiautomator2 as u2
d=None
for _cand in [SERIAL,'127.0.0.1:15557','127.0.0.1:15555']:
    try:
        d=u2.connect(_cand); SERIAL=_cand; break
    except Exception:
        d=None
def ensure_conversation():
    # 2026-11-13: 收起通知栏，并确保真的在会话页（有"发送消息"输入提示）
    adb('shell', 'cmd', 'statusbar', 'collapse')
    xml = ''
    for _attempt in range(4):
        try:
            xml = d.dump_hierarchy()
        except Exception:
            xml = ''
        log({'type':'nav-dump','n':_attempt,'input':('发送消息' in xml),'title':('霸王辣条丝' in xml),'nodes':len(_nodes(xml))})
        if '发送消息' in xml and '霸王辣条丝' in xml:
            return xml
        # 2026-11-14：弹层/分享页（火花页等）里没有输入框也没有底部导航 → 先按返回
        if '发送消息' not in xml and '消息' not in xml:
            adb('shell', 'input', 'keyevent', '4')
            time.sleep(1.0)
            try: xml = d.dump_hierarchy()
            except Exception: xml = ''
            if '发送消息' in xml and '霸王辣条丝' in xml:
                return xml
        nodes = _nodes(xml)
        p = None
        for _n in nodes:
            if _n[0] == '消息' and _n[2] > 2000:
                p = ((_n[1] + _n[3]) // 2, (_n[2] + _n[4]) // 2)
                break
        if p:
            d.click(p[0], p[1])
            time.sleep(2)
        try:
            xml = d.dump_hierarchy()
        except Exception:
            xml = ''
        nodes = _nodes(xml)
        # 2026-11-14: 会话行按"整行中间"点（text/content-desc 都认，y>700）
        cands = [n for n in nodes if '霸王辣条丝' in str(n[0]) and n[2] > 700]
        if cands:
            n = sorted(cands, key=lambda z: z[2])[0]
            d.click(540, n[2] + 60)
            time.sleep(2.5)
    return xml


def _nodes(xml):
    out = []
    for m in re.finditer(r'<node[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        out.append((m.group(1), [int(m.group(k)) for k in (2, 3, 4, 5)]))
    for m in re.finditer(r'<node[^>]*content-desc="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        if m.group(1):
            out.append((m.group(1), [int(m.group(k)) for k in (2, 3, 4, 5)]))
    seen = set()
    keep = []
    for t, v in out:
        key = (t, v[0], v[1], v[2], v[3])
        if key in seen:
            continue
        seen.add(key)
        keep.append((t, v[0], v[1], v[2], v[3]))
    return keep
def has_douyin_notif():
    """2026-11-13: 1 秒级快查——通知栏里有没有抖音新消息（比 dump 控件树便宜）"""
    try:
        out = adb('shell', 'dumpsys notification --noredact | grep -c com.ss.android.ugc.aweme', timeout=8)
        return int((out or '0').strip() or '0') > 0
    except Exception:
        return True  # 查不到就按有消息处理，别漏

def persona_bad(t):
    """客服腔/讨好腔检测（2026-11-13：她的记忆被污染后语气变软）"""
    for w in ('对不起', '抱歉', '误会', '客服', '非常理解', '您'):
        if w in t:
            return True
    return False


def persona_clean(t):
    """把客服腔的句子整句删掉；删空了就退回原文"""
    parts = []
    for seg in t.replace(chr(10), '。').split('。'):
        seg = seg.strip()
        if not seg:
            continue
        if persona_bad(seg):
            continue
        parts.append(seg)
    out = '。'.join(parts).strip()
    return out if out else t


def main():
    global d
    st=load_state(); last_seen=''
    while True:
        if os.path.exists(STOP): log({'type':'stop'}); return
        if d is None:
            try:
                d=u2.connect(SERIAL)
                log({'type':'reconnect','serial':SERIAL})
            except Exception:
                time.sleep(3); continue
        try:
            _n = globals().get("_LOOP_N", 0) + 1
            globals()["_LOOP_N"] = _n
            if _n > 1 and (_n % 3 != 0) and (not has_douyin_notif()):
                time.sleep(0.7); continue
            xml=ensure_conversation()
            if '发送消息' not in xml:
                time.sleep(2); continue
            msgs,nodes=parse(xml)
            if not msgs: time.sleep(1.2); continue
            our_y=None
            for y,t in msgs:
                if st.get('last_reply') and t==st['last_reply']: our_y=y
            pend=[t for y,t in msgs if our_y is None or y>our_y]
            clean=[]
            for t in pend:
                if t==st.get('last_reply'): continue
                if not clean or clean[-1]!=t: clean.append(t)
            if not clean: time.sleep(1.2); continue
            if clean[-1]==st.get('last_user'): time.sleep(1.2); continue  # 2026-11-13: 只取了对方消息后，用 last_user 判新
            user_text=chr(10).join(clean[-4:])
            if user_text==last_seen: time.sleep(1.2); continue
            day=time.strftime('%Y-%m-%d')
            if st.get('day')!=day: st['day']=day; st['count']=0
            if st.get('count',0)>=200: log({'type':'rate-day-cap'}); time.sleep(60); continue
            if time.time()-st.get('last_at',0)<12: log({'type':'rate-wait'}); time.sleep(1.2); continue
            last_seen=user_text
            log({'type':'user','text':user_text})
            user_text=user_text.replace(chr(10),' ').strip()  # 2026-11-13: 换行先压平，aiji 对多行容易报参数错
            ask_text=user_text
            for _w in ('参数错误','系统繁忙','服务异常'):
                ask_text=ask_text.replace(_w,'那个报错')  # 2026-11-13: aiji 见到这词会复读自己的报错
            reply=ask_aiji(user_text)
            BAD=('参数错误','系统繁忙','服务异常')
            if (not reply) or (reply.strip() in BAD) or (len(reply.strip())<2):
                short=user_text.split(chr(10))[-1][:40].strip()
                log({'type':'aiji-retry','text':short})
                reply=ask_aiji(short) if short else reply
            if (not reply) or (reply.strip() in ('参数错误','系统繁忙')) or (len(reply.strip())<2):
                log({'type':'aiji-bad','text':reply[:40]}); time.sleep(5); continue
            if not reply: time.sleep(5); continue
            if reply and persona_bad(reply):
                # 2026-11-13: 不再回头问模型（提示词会污染她的记忆），直接本地清掉客服腔那句
                log({'type':'persona-clean','text':reply[:30]})
                reply=persona_clean(reply)
            log({'type':'reply','text':reply})
            m=re.search(r'<node[^>]*resource-id="com.ss.android.ugc.aweme:id/msg_et"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',xml)
            if m: d.click((int(m.group(1))+int(m.group(3)))//2,(int(m.group(2))+int(m.group(4)))//2)
            # 2026-11-13: 用 u2 的 FastInputIME 打字（OPPO 默认百度输入法收不到 ADB 广播）
            try:
                d.set_fastinput_ime(True)
            except Exception as e:
                log({'type': 'ime-fail', 'msg': str(e)[:80]})
                time.sleep(1)
                continue
            time.sleep(0.6)
            try:
                xml2 = d.dump_hierarchy()
            except Exception:
                xml2 = ''
            m = re.search(r'<node[^>]*resource-id="com.ss.android.ugc.aweme:id/msg_et"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml2)
            if m:
                d.click((int(m.group(1)) + int(m.group(3))) // 2, (int(m.group(2)) + int(m.group(4))) // 2)
                time.sleep(0.7)
            try:
                d.send_keys(reply)
            except Exception as e:
                log({'type': 'type-fail', 'err': str(e)[:80]})
            time.sleep(1.2)
            xml2 = d.dump_hierarchy()
            if reply[:6] not in xml2:
                log({'type': 'type-fail', 'text': reply[:30]})
                # 兜底 1：直接切 ADBKeyboard 用广播塞字
                try:
                    adb('shell', 'ime', 'set', 'com.android.adbkeyboard/.AdbIME')
                    time.sleep(0.7)
                    b64 = base64.b64encode(reply.encode()).decode()
                    adb('shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b64)
                    time.sleep(1.4)
                    xml2 = d.dump_hierarchy()
                except Exception as e:
                    log({'type': 'type-fail2', 'err': str(e)[:60]})
                if reply[:6] not in xml2:
                    log({'type': 'type-abort', 'text': reply[:30]})
                    try:
                        adb('shell', 'ime', 'set', 'com.baidu.input_oppo/.ImeService')
                    except Exception:
                        pass
                    time.sleep(1)
                    continue
            s = re.search(r'<node[^>]*content-desc="发送"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml2)
            if s:
                d.click((int(s.group(1)) + int(s.group(3))) // 2, (int(s.group(2)) + int(s.group(4))) // 2)
            else:
                log({'type': 'no-send-button'})
                try:
                    d.set_fastinput_ime(False)
                except Exception:
                    pass
                time.sleep(1)
                continue
            chk=d.dump_hierarchy()
            ok=(reply[:8] in chk) and (not re.search(r'resource-id="com.ss.android.ugc.aweme:id/msg_et"[^>]*text="[^"]+"',chk))
            adb('shell','ime','set','com.baidu.input_oppo/.ImeService')
            log({'type':'sent','ok':ok,'text':reply[:30]})
            if ok:
                st['last_reply']=reply; st['last_user']=user_text
                st['count']=st.get('count',0)+1; st['last_at']=time.time(); save_state(st)
        except Exception as e:
            log({'type':'error','msg':str(e)[:200]}); time.sleep(3)
main()
