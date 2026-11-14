#!/usr/bin/env python3
# 全面状态检查（2026-11-11 15:55）
import subprocess, os, json, re

def run(cmd):
    return subprocess.run(["bash", "-c", cmd], capture_output=True, text=True).stdout

def now():
    return run("TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S'").strip()

print("════════ 全面状态 ════════")
print("时间:", now())
print()

# 1. 服务
svcs = ["aiji", "herqq-bridge", "her-mind.timer", "napcat", "her-watchdog.timer", "xvfb-qq"]
print("【服务】")
for s in svcs:
    st = run("systemctl is-active " + s + " 2>/dev/null").strip()
    print("  " + s.ljust(20) + ("✅ " + st if st == "active" else "❌ " + st))
print()

# 2. QQ
listen = ":6199" in run("ss -tln 2>/dev/null")
tn = run("ss -tn 2>/dev/null")
estab = len([l for l in tn.split("\n") if "ESTAB" in l and "6199" in l])
print("【QQ】")
print("  6199 监听:", "✅" if listen else "❌")
print("  ESTAB 连接:", estab, "个", "✅" if estab > 0 else "❌ (需扫码)")
print()

# 3. 内核
print("【内核】")
paused = os.path.exists("/opt/her/her-paused.json")
fatal = os.path.exists("/opt/her/NOTIFY-FATAL.txt")
print("  暂停:", "❌ 有" if paused else "✅ 无")
print("  fatal:", "❌ 有" if fatal else "✅ 无")
alert = run("/opt/node/bin/node /opt/her/her-contract.mjs alert 2>&1")
print("  告警:", "✅ 无" if "无告警" in alert else "⚠️ " + alert.split("\n")[-2].strip()[:60])
t = run("systemctl list-timers her-mind.timer --no-pager 2>/dev/null | sed -n '2p'")
print("  下次 tick:", t[:50] if t else "?")
print()

# 4. 真实产出
print("【真实产出】")
novel_dir = "/opt/her/novel/正文"
total = 0
if os.path.isdir(novel_dir):
    for f in sorted(os.listdir(novel_dir)):
        if f.endswith(".md"):
            n = len(open(os.path.join(novel_dir, f), encoding="utf-8").read().replace(" ", "").replace("\n", ""))
            total += n
            print("  " + f + ": " + str(n) + " 字")
print("  小说合计: " + str(total) + " 字")
vid_dir = "/opt/her/toon-episodes"
vids = [x for x in os.listdir(vid_dir) if x.endswith(".mp4")] if os.path.isdir(vid_dir) else []
print("  视频: " + str(len(vids)) + " 条")
print()

# 5. 目标
print("【目标】")
try:
    m = json.load(open("/opt/her/her-mind.json", encoding="utf-8"))
    for g in m.get("goals", []):
        pct = min(100, round(g.get("current", 0) / g.get("target", 1) * 100, 1))
        print("  " + g.get("id", "").ljust(8) + " " + str(g.get("current", 0)) + "/" + str(g.get("target", 0)) + " " + g.get("unit", "") + " (" + str(pct) + "%) phase=" + str(g.get("phase", "active")))
    print("  完成归档:", len(m.get("completedGoals", [])), "个")
except Exception as e:
    print("  读取失败:", e)
print()

# 6. 主动性
print("【主动性】")
proactive_file = "/opt/her/her-proactive.jsonl"
if os.path.exists(proactive_file):
    n = 0
    replied = 0
    for l in open(proactive_file, encoding="utf-8"):
        l = l.strip()
        if not l: continue
        try:
            r = json.loads(l)
        except: continue
        if r.get("type") != "proactive": continue
        if str(r.get("at", "")).startswith("2026-11-11"):
            n += 1
            if r.get("repliedAt"): replied += 1
    print("  今天发了:", n, "条，被回:", replied, "条")
print()

# 7. 修复日志
print("【修复日志】")
if os.path.exists("/opt/her/FIX-LOG.md"):
    c = open("/opt/her/FIX-LOG.md", encoding="utf-8").read()
    print("  条目数:", c.count("\n### "))
