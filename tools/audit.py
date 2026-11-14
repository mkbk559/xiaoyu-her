#!/usr/bin/env python3
"""
大肥鱼 系统架构审计（2026-11-11）
列出所有节点，判断是否冗余。
"""
import os
import subprocess
import re
import json

H = "/opt/her"

def run(cmd):
    return subprocess.run(["bash", "-c", cmd], capture_output=True, text=True).stdout

print("════════════════════════════════════════════════════════")
print("           大肥鱼 系统架构审计")
print("════════════════════════════════════════════════════════")
print()

# ══════ 1. systemd 单元 ══════
print("【1】systemd 单元")
print()

svcs = ["aiji", "her-chat", "herqq-bridge", "napcat", "xvfb-qq",
        "her-mind.timer", "her-watchdog.timer", "night-watch.timer",
        "her-news.timer", "her-mind.service", "her-watchdog.service",
        "night-watch.service", "her-news.service"]
rows = []
for s in svcs:
    st = run(f"systemctl is-active {s} 2>/dev/null").strip()
    en = run(f"systemctl is-enabled {s} 2>/dev/null").strip()
    rows.append((s, st, en))

print(f"  {'单元名':<24} {'状态':<10} {'开机启动'}")
print("  " + "-" * 50)
for s, st, en in rows:
    mark = "✅" if st == "active" else ("⏸" if st == "inactive" and "timer" in s else "❌")
    print(f"  {mark} {s:<22} {st:<10} {en}")

print()

# ══════ 2. 定时器 ══════
print("【2】定时器（谁在跑，跑什么）")
print()

timers = run("systemctl list-timers --all --no-pager 2>/dev/null").split("\n")
for line in timers[1:]:
    if "her-" in line or "night-watch" in line or "crawl" in line:
        parts = line.split()
        if len(parts) >= 5:
            # 找 timer 名
            for p in parts:
                if ".timer" in p:
                    print(f"  {p}")
                    break

print()

# ══════ 3. 脚本文件 ══════
print("【3】/opt/her 下的脚本")
print()

scripts = []
for f in sorted(os.listdir(H)):
    p = os.path.join(H, f)
    if not os.path.isfile(p):
        continue
    if not (f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py") or f.endswith(".js")):
        continue
    sz = os.path.getsize(p)
    mtime = os.path.getmtime(p)
    scripts.append((f, sz, mtime))

# 按修改时间排序
scripts.sort(key=lambda x: -x[2])
print(f"  共 {len(scripts)} 个脚本")
print()
print(f"  {'文件':<32} {'大小':>8}  {'最近修改'}")
print("  " + "-" * 62)
import time
for f, sz, mt in scripts:
    t = time.strftime("%m-%d %H:%M", time.localtime(mt))
    print(f"  {f:<32} {sz:>7}B  {t}")

print()

# ══════ 4. 数据文件 ══════
print("【4】数据文件（状态）")
print()

data_files = []
for f in sorted(os.listdir(H)):
    p = os.path.join(H, f)
    if not os.path.isfile(p):
        continue
    if f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py"):
        continue
    if f.startswith("."):
        continue
    sz = os.path.getsize(p)
    if sz < 10:
        continue
    data_files.append((f, sz))

for f, sz in sorted(data_files, key=lambda x: -x[1]):
    print(f"  {f:<36} {sz:>9}B")

print()

# ══════ 5. 目录 ══════
print("【5】目录")
print()

for f in sorted(os.listdir(H)):
    p = os.path.join(H, f)
    if os.path.isdir(p):
        try:
            n = len(os.listdir(p))
        except Exception:
            n = 0
        # 算大小
        sz = int(run(f"du -sb '{p}' 2>/dev/null | cut -f1").strip() or 0)
        print(f"  {f:<28} {n:>4} 项  {sz//1024:>8}KB")

print()

# ══════ 6. 判断冗余 ══════
print("【6】冗余判断")
print()

# 检查未被引用的脚本
print("  (a) 检查哪些脚本没被任何人引用")

all_code = ""
for f in os.listdir(H):
    p = os.path.join(H, f)
    if os.path.isfile(p) and (f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py")):
        try:
            all_code += open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            pass

# 加上 systemd 配置
systemd_dir = "/etc/systemd/system"
for f in os.listdir(systemd_dir):
    if f.endswith(".service") or f.endswith(".timer"):
        try:
            all_code += open(os.path.join(systemd_dir, f), encoding="utf-8", errors="ignore").read()
        except Exception:
            pass

unused = []
for f, sz, mt in scripts:
    if f in ("her-mind.mjs", "her-soul.mjs", "her-world.mjs", "her-contract.mjs",
             "her-arbiter.mjs", "her-goals.mjs", "her-verify.mjs", "her-plugin-copy.mjs",
             "bridge.mjs"):
        continue
    # 在别处出现过吗
    cnt = all_code.count(f)
    if cnt <= 1:  # 只有自己文件头
        unused.append(f)

for f in unused:
    print(f"    ⚠️ {f}  （可能是孤立的）")

print()

# 找相同功能的文件
print("  (b) 功能重叠检查")
overlaps = [
    ("her-mind.mjs", "主内核"),
    ("her-goals.mjs", "目标管理（已改为读 her-mind.json）"),
    ("her-complete.mjs", "目标完成归档"),
    ("her-contract.mjs", "执行契约/告警"),
    ("her-arbiter.mjs", "组合契约/仲裁"),
    ("her-soul.mjs", "关系/记忆/人格"),
    ("her-world.mjs", "世界感知"),
    ("her-consume.mjs", "消息消费"),
    ("her-ops.mjs", "运维/健康"),
    ("her-verify.mjs", "质量验证"),
    ("her-veto.mjs", "第三份验证集"),
]
for f, desc in overlaps:
    p = os.path.join(H, f)
    exists = os.path.exists(p)
    print(f"    {'✓' if exists else '✗'} {f:<22} {desc}")

print()

# ══════ 7. 端口占用 ══════
print("【7】端口占用")
print()
ports = run("ss -tlnp 2>/dev/null | grep -E ':(8787|8788|6199|6099|3065)'").split("\n")
for p in ports:
    if p.strip():
        m = re.search(r"127\.0\.0\.1:(\d+)|0\.0\.0\.0:(\d+)|\*:(\d+)", p)
        port = None
        for g in (m.groups() if m else []):
            if g: port = g
        proc = ""
        pm = re.search(r'users:\(\("([^"]+)"', p)
        if pm: proc = pm.group(1)
        print(f"    :{port}  {proc}")
