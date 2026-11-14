#!/usr/bin/env python3
"""
功能节点盘点（2026-11-11）
用户问：「帮我看看她的所有功能节点，看看是不是乱七八糟的」

盘点：
1. 所有 systemd 服务/timer
2. 所有 .mjs / .py 脚本 + 职责
3. 所有数据文件
4. 调用关系（谁 import 谁）
5. 找出：重复/废弃/孤儿
"""
import os
import re
import json
import subprocess

H = "/opt/her"
HQ = "/opt/herqq"

def run(cmd):
    return subprocess.run(["bash", "-c", cmd], capture_output=True, text=True).stdout

print("═══════════════════════════════════════")
print("  大肥鱼 功能节点盘点")
print("═══════════════════════════════════════")
print()

# ══════ 1. 服务 ══════
print("【1】Systemd 服务")
svcs = run("systemctl list-units --type=service --state=running --no-pager 2>/dev/null").split("\n")
her_svcs = [l for l in svcs if any(k in l for k in ["aiji", "her", "napcat", "xvfb"])]
for l in her_svcs:
    parts = l.split()
    if len(parts) >= 2:
        print(f"  ✅ {parts[0]:30s} {parts[1]}")
print()

# ══════ 2. Timer ══════
print("【2】Timer（定时任务）")
timers = run("systemctl list-timers --no-pager 2>/dev/null").split("\n")
for l in timers:
    if any(k in l for k in ["her-", "night-"]):
        parts = l.split()
        if parts:
            # 找 timer 名字
            for p in parts:
                if p.endswith(".timer"):
                    nxt = parts[0] if parts else "?"
                    print(f"  ⏰ {p:28s} 下次: {nxt}")
                    break
print()

# ══════ 3. 脚本 ══════
print("【3】可用脚本（.mjs / .py）")

# 每个脚本的职责（从注释里读）
def get_purpose(path):
    try:
        src = open(path, encoding="utf-8", errors="ignore").read(2000)
        # 找第一行注释或 /** */ 块
        m = re.search(r"/\*\*?\s*\n?\s*\*?\s*(.+)", src)
        if m:
            return m.group(1).strip()[:60]
        m = re.search(r'"""\s*\n?(.+)', src)
        if m:
            return m.group(1).strip()[:60]
        for line in src.split("\n")[:5]:
            if line.strip().startswith("//"):
                return line.strip()[2:].strip()[:60]
    except Exception:
        pass
    return ""

mjs = sorted([f for f in os.listdir(H) if f.endswith(".mjs")])
print(f"\n  主目录脚本（{len(mjs)} 个）：")
for f in mjs:
    p = os.path.join(H, f)
    purpose = get_purpose(p)
    size = os.path.getsize(p) // 1024
    print(f"    {f:26s} {size:3d}KB  {purpose}")

py = sorted([f for f in os.listdir(H) if f.endswith(".py")])
print(f"\n  Python 脚本（{len(py)} 个）：")
for f in py:
    p = os.path.join(H, f)
    purpose = get_purpose(p)
    size = os.path.getsize(p) // 1024
    print(f"    {f:26s} {size:3d}KB  {purpose}")
print()

# ══════ 4. 数据文件 ══════
print("【4】数据文件（>1KB）")
data_files = []
for root, dirs, files in os.walk(H):
    # 跳过 node_modules 之类
    if any(x in root for x in ["node_modules", ".git", "ego-win"]):
        continue
    for f in files:
        if f.endswith((".json", ".jsonl", ".md", ".log", ".db")):
            p = os.path.join(root, f)
            try:
                sz = os.path.getsize(p)
                if sz > 1024:
                    data_files.append((p.replace(H + "/", ""), sz))
            except Exception:
                pass
data_files.sort(key=lambda x: -x[1])
for p, sz in data_files[:30]:
    print(f"  {p:60s} {sz//1024:5d}KB")
print(f"  ... 共 {len(data_files)} 个")
print()

# ══════ 5. 调用关系 ══════
print("【5】调用关系（谁 import 谁）")
imports = {}
for f in mjs:
    p = os.path.join(H, f)
    try:
        src = open(p, encoding="utf-8", errors="ignore").read()
        deps = re.findall(r"from ['\"](/opt/her/[\w.-]+\.mjs)['\"]", src)
        deps = [d.split("/")[-1] for d in deps]
        if deps:
            imports[f] = deps
    except Exception:
        pass

for f, deps in imports.items():
    print(f"  {f:24s} → {', '.join(deps)}")
print()

# ══════ 6. 找孤儿/重复 ══════
print("【6】问题诊断")

# 6.1 没被 import 的脚本（可能是孤儿）
all_deps = set()
for deps in imports.values():
    all_deps.update(deps)

# 哪些是被 main 入口用的
entry_points = ["her-mind.mjs", "her-contract.mjs", "her-soul.mjs", "her-world.mjs",
                "her-consume.mjs", "her-arbiter.mjs", "her-ops.mjs", "her-goals.mjs",
                "her-complete.mjs", "her-verify.mjs", "her-veto.mjs"]

print("\n  6.1 孤儿脚本（没被任何脚本 import，且不是入口）：")
orphans = []
for f in mjs:
    if f in all_deps or f in entry_points:
        continue
    # 检查是否被 timer/service 调用
    used_in_timer = False
    for base in ["/etc/systemd/system", H]:
        try:
            if os.path.isdir(base):
                for rf in os.listdir(base):
                    if rf.endswith((".service", ".timer")):
                        try:
                            content = open(os.path.join(base, rf), encoding="utf-8", errors="ignore").read()
                            if f in content:
                                used_in_timer = True
                                break
                        except Exception:
                            pass
        except Exception:
            pass
    if not used_in_timer:
        orphans.append(f)
if orphans:
    for f in orphans:
        print(f"    ⚠️ {f}")
else:
    print("    ✅ 没有孤儿")

# 6.2 重复功能的文件
print("\n  6.2 可能重复的：")
dup_suspects = {
    "her-trace.jsonl": "契约层的 trace",
    "night-watch.log": "监控日志（和 trace 有重叠？）",
    "her-world-news.json": "新闻缓存",
    "her-proactive.jsonl": "主动消息记录",
}
for f, desc in dup_suspects.items():
    p = os.path.join(H, f)
    if os.path.exists(p):
        print(f"    {f:24s} {desc}")

# 6.3 目录结构
print("\n  6.3 目录结构：")
dirs = sorted([d for d in os.listdir(H) if os.path.isdir(os.path.join(H, d))])
for d in dirs:
    n = len(os.listdir(os.path.join(H, d))) if os.path.isdir(os.path.join(H, d)) else 0
    print(f"    {d:24s} {n:3d} 项")

# 6.4 桥接目录
print("\n  6.4 桥接目录 /opt/herqq：")
if os.path.isdir(HQ):
    for f in sorted(os.listdir(HQ)):
        p = os.path.join(HQ, f)
        if os.path.isfile(p):
            print(f"    {f:24s} {os.path.getsize(p)//1024:3d}KB")

print()
print("═══════════════════════════════════════")
