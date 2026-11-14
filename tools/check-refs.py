#!/usr/bin/env python3
"""
检查每个脚本是否被引用（2026-11-11）
只列出「被谁引用」和「没人引用」
"""
import os
import re

H = "/opt/her"
SYSTEMD = "/etc/systemd/system"

# 收集所有代码
all_code = {}
for d in [H, "/opt/herqq", "/opt/her/cloud"]:
    if not os.path.isdir(d):
        continue
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if not os.path.isfile(p):
            continue
        if not (f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py") or f.endswith(".js")):
            continue
        try:
            all_code[f] = open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            pass

# systemd 配置
sysd = ""
if os.path.isdir(SYSTEMD):
    for f in os.listdir(SYSTEMD):
        if f.endswith(".service") or f.endswith(".timer"):
            try:
                sysd += open(os.path.join(SYSTEMD, f), encoding="utf-8", errors="ignore").read()
            except Exception:
                pass

# 检查每个脚本
print("════════ 引用检查 ════════")
print()

used = []
unused = []

for f in sorted(all_code):
    # 在别的文件里出现吗
    refs = []
    for other, code in all_code.items():
        if other == f:
            continue
        if f in code:
            refs.append(other)
    if f in sysd:
        refs.append("systemd")

    if refs:
        used.append((f, refs))
    else:
        unused.append(f)

print(f"【被引用的】{len(used)} 个")
for f, refs in used:
    print(f"  ✓ {f:<30} ← {', '.join(refs[:3])}")
print()

print(f"【没人引用的】{len(unused)} 个")
for f in unused:
    p = os.path.join(H, f)
    sz = os.path.getsize(p) if os.path.exists(p) else 0
    print(f"    {f:<34} {sz:>7}B")
