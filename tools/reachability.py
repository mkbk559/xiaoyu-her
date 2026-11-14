#!/usr/bin/env python3
"""
真正的可达性分析（2026-11-11）
从 systemd 单元出发，沿着 import/引用 链，看哪些脚本是「活的」。
"""
import os
import re

H = "/opt/her"
HERQQ = "/opt/herqq"
SYSTEMD = "/etc/systemd/system"

# ══════ 1. 收集所有脚本内容 ══════
code = {}
for d in [H, HERQQ]:
    if not os.path.isdir(d):
        continue
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if os.path.isfile(p) and (f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py") or f.endswith(".js")):
            try:
                code[f] = open(p, encoding="utf-8", errors="ignore").read()
            except Exception:
                pass

# ══════ 2. 从 systemd 找入口 ══════
entries = set()
sysd_text = ""
if os.path.isdir(SYSTEMD):
    for f in os.listdir(SYSTEMD):
        if f.endswith(".service"):
            try:
                t = open(os.path.join(SYSTEMD, f), encoding="utf-8", errors="ignore").read()
                sysd_text += t
            except Exception:
                pass

# 从 systemd 配置里找脚本名
for m in re.finditer(r"([\w\-\.]+\.(?:mjs|sh|py|js))", sysd_text):
    name = m.group(1)
    if name in code:
        entries.add(name)

# 加上已知入口（on-boot / 手动）
manual_entries = ["bridge.mjs", "her-watchdog.sh", "night-watch.sh",
                  "her-world-news.py", "her-mind.mjs", "chat-server.mjs"]
for e in manual_entries:
    if e in code:
        entries.add(e)

# ══════ 3. 遍历（BFS）══════
reachable = set(entries)
queue = list(entries)

while queue:
    cur = queue.pop(0)
    if cur not in code:
        continue
    body = code[cur]
    # 找它引用的其他脚本
    for m in re.finditer(r"['\"`]([\w\-\./]+\.(?:mjs|sh|py|js))['\"`]", body):
        ref = os.path.basename(m.group(1))
        if ref in code and ref not in reachable:
            reachable.add(ref)
            queue.append(ref)

# ══════ 4. 报告 ══════
print("════════ 可达性分析 ════════")
print()
print(f"入口（systemd 或手动）：")
for e in sorted(entries):
    print(f"  ★ {e}")
print()
print(f"从入口可达的：{len(reachable)} 个")
for f in sorted(reachable):
    print(f"  ✅ {f}")
print()

dead = [f for f in sorted(code) if f not in reachable]
print(f"不可达（死的）：{len(dead)} 个")
total_sz = 0
for f in dead:
    p = os.path.join(H, f)
    sz = os.path.getsize(p) if os.path.exists(p) else 0
    total_sz += sz
    print(f"  💀 {f:<34} {sz:>7}B")
print()
print(f"死脚本合计：{len(dead)} 个，{total_sz//1024} KB")
