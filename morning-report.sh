#!/bin/bash
# 明早汇总报告（2026-11-11 夜间跑完生成）
export PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin
cd /opt/her

OUT=/opt/her/MORNING-REPORT.md

{
echo "# 大肥鱼 夜间运行报告"
echo ""
echo "生成时间: $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "---"
echo ""

# ── 1. 健康 ──
echo "## 1. 机器报告"
echo ""
echo "### 1.1 健康检查（her-ops health）"
echo '```'
/opt/node/bin/node her-ops.mjs health 2>&1
echo '```'
echo ""

# ── 2. 内核状态 ──
echo "### 1.2 内核状态（her-mind state）"
echo '```'
/opt/node/bin/node her-mind.mjs state 2>&1
echo '```'
echo ""

# ── 3. 主动性 ──
echo "### 1.3 主动性消费（her-consume pending）"
echo '```'
/opt/node/bin/node her-consume.mjs pending 2>&1
echo '```'
echo ""

# ── 4. 质量基准 ──
echo "### 1.4 第三份验证集（her-veto）"
echo '```'
/opt/node/bin/node her-veto.mjs 2>&1
echo '```'
echo ""

# ── 5. 成本 ──
echo "### 1.5 成本对账"
echo '```'
/opt/node/bin/node her-contract.mjs cost 2>&1
echo '```'
echo ""

# ── 6. 告警 ──
echo "### 1.6 告警"
echo '```'
/opt/node/bin/node her-contract.mjs alert 2>&1
echo '```'
echo ""

echo "---"
echo ""
echo "## 2. 人工抽检素材"
echo ""

# ── 3 段小说 ──
echo "### 2.1 小说抽 3 段"
echo ""
python3 <<'PYEOF'
import os, re, random
d = "/opt/her/novel/正文"
segs = []
for f in sorted(os.listdir(d)):
    if not f.endswith(".md"): continue
    t = open(d + "/" + f, encoding="utf-8").read()
    parts = re.split(r"^##\s", t, flags=re.M)
    for p in parts:
        p = p.strip()
        if len(p.replace("\n", "").replace(" ", "")) > 300:
            segs.append((f, p))
print(f"共 {len(segs)} 段（>300字）")
print()
# 抽 3 段：取最后 3 段
for i, (f, p) in enumerate(segs[-3:], 1):
    n = len(p.replace("\n", "").replace(" ", ""))
    print(f"**第 {i} 段**（{f}，{n} 字）")
    print()
    print("```")
    print(p[:600])
    if len(p) > 600: print("...")
    print("```")
    print()
PYEOF
echo ""

# ── 3 条反思 ──
echo "### 2.2 反思抽 3 条"
echo ""
python3 <<'PYEOF'
import os, json
p = "/opt/her/her-reflections.jsonl"
if os.path.exists(p):
    lines = [l for l in open(p, encoding="utf-8") if l.strip()]
    print(f"共 {len(lines)} 条反思")
    print()
    for l in lines[-3:]:
        try:
            r = json.loads(l)
            print(f"**{r.get('at')}**")
            print(f"- did: {r.get('did')}")
            print(f"- learned: {r.get('learned')}")
            print(f"- next: {r.get('next')}")
            print(f"- shouldTell: {r.get('shouldTell')}")
            print()
        except: pass
else:
    print("（还没反思记录）")
PYEOF
echo ""

# ── 3 条主动消息 ──
echo "### 2.3 主动消息抽 3 条"
echo ""
python3 <<'PYEOF'
import os, json
p = "/opt/her/her-proactive.jsonl"
if os.path.exists(p):
    rows = []
    for l in open(p, encoding="utf-8"):
        l = l.strip()
        if not l: continue
        try:
            r = json.loads(l)
            if r.get("type") == "proactive": rows.append(r)
        except: pass
    print(f"共 {len(rows)} 条主动消息")
    print()
    for r in rows[-3:]:
        print(f"**{r.get('at')}**")
        print(f"- 说: {r.get('text')}")
        print(f"- 理由: {r.get('reason')}")
        print(f"- 被回: {bool(r.get('repliedAt'))}" + (f"  回: {r.get('replyText')}" if r.get('repliedAt') else ""))
        print()
else:
    print("（还没主动消息）")
PYEOF
echo ""

echo "---"
echo ""
echo "## 3. 归因分析"
echo ""
echo "### 3.1 门冲突统计"
echo '```'
python3 <<'PYEOF'
import os, json
p = "/opt/her/her-trace.jsonl"
if os.path.exists(p):
    rows = []
    for l in open(p, encoding="utf-8"):
        l = l.strip()
        if not l: continue
        try: rows.append(json.loads(l))
        except: pass
    ticks = [r for r in rows if r.get("kind") == "tick"]
    print(f"tick 总数: {len(ticks)}")
    from collections import Counter
    goals = Counter(r.get("goalId") for r in ticks)
    print(f"目标分布: {dict(goals)}")
    notes = Counter()
    for r in ticks:
        note = str(r.get("note",""))
        if "persona" in note: notes["人格门"] += 1
        elif "quality" in note: notes["质量门"] += 1
        elif "跳过" in note or r.get("skipped"): notes["跳过"] += 1
        elif r.get("ok"): notes["成功"] += 1
        else: notes["其他"] += 1
    print(f"结果分布: {dict(notes)}")
else:
    print("（无 trace）")
PYEOF
echo '```'

echo ""
echo "### 3.2 暂停/告警记录"
echo '```'
echo "暂停文件: $([ -f her-paused.json ] && echo '有' || echo '无')"
echo "fatal 文件: $([ -f NOTIFY-FATAL.txt ] && echo '有' || echo '无')"
echo "QQ-DOWN 文件: $([ -f NOTIFY-QQ-DOWN.txt ] && echo '有' || echo '无')"
echo ""
echo "--- 最近 10 条告警 ---"
tail -10 her-alerts.jsonl 2>/dev/null || echo "（无）"
echo '```'

echo ""
echo "### 3.3 watchdog 记录"
echo '```'
tail -20 /var/log/her-watchdog.log 2>/dev/null
echo '```'

echo ""
echo "### 3.4 主动性 skip 原因"
echo '```'
python3 <<'PYEOF'
import os, json
from collections import Counter
p = "/opt/her/her-proactive-skip.jsonl"
if os.path.exists(p):
    reasons = Counter()
    for l in open(p, encoding="utf-8"):
        l = l.strip()
        if not l: continue
        try:
            r = json.loads(l)
            reasons[r.get("reason","?")] += 1
        except: pass
    print(f"skip 总数: {sum(reasons.values())}")
    for k, v in reasons.most_common():
        print(f"  {k}: {v}")
else:
    print("（无 skip 记录）")
PYEOF
echo '```'

} > $OUT 2>&1

echo "报告已生成: $OUT"
wc -l $OUT
