#!/usr/bin/env python3
"""检查 import 了但没用的情况（2026-11-11）"""
import re

files = [
    "/opt/herqq/bridge.mjs",
    "/opt/her/her-mind.mjs",
    "/opt/her/her-world.mjs",
]

for path in files:
    try:
        src = open(path, encoding="utf-8").read()
    except Exception as e:
        print(f"{path}: 读取失败 {e}")
        continue

    print(f"═══ {path} ═══")

    # 提取 import 的名字
    imported = []
    for m in re.finditer(r"import \{([^}]+)\} from", src):
        for name in m.group(1).split(","):
            name = name.strip()
            if name:
                imported.append(name)

    # 检查每个名字在 import 行之外出现几次
    lines = src.split("\n")
    for name in imported:
        count = 0
        for line in lines:
            if line.strip().startswith("import "):
                continue
            # 简单词边界匹配
            if re.search(r"\b" + re.escape(name) + r"\b", line):
                count += 1
        mark = "❌ 未使用" if count == 0 else f"✅ {count} 次"
        print(f"  {name.ljust(28)} {mark}")
    print()
