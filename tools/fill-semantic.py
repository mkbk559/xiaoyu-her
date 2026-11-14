#!/usr/bin/env python3
# 从 AIJiYi 提取关键事实，写入 her-soul 的 semantic 记忆层（2026-11-11）
import json
import sqlite3
import os
from datetime import datetime, timezone, timedelta

DB = "/opt/aijiyi/data/aiji.db"
SOUL = "/opt/her/her-soul.json"

def now_cn():
    return (datetime.now(timezone.utc) + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")

if not os.path.exists(DB):
    print("AIJiYi 数据库不存在")
    raise SystemExit(1)

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

# 拉取高重要性的 facts（语义记忆 = 稳定的事实）
facts = []
try:
    rows = con.execute("""
        SELECT subject, predicate, object, importance
        FROM fact
        WHERE platform='desktop' AND platform_user_id='dafeiyu'
          AND importance >= 0.6
        ORDER BY importance DESC, id DESC
        LIMIT 40
    """).fetchall()
    for r in rows:
        d = dict(r)
        obj = str(d.get("object") or "")[:80]
        pred = str(d.get("predicate") or "")
        if obj and pred:
            facts.append({
                "at": now_cn(),
                "subject": str(d.get("subject") or "")[:30],
                "predicate": pred[:30],
                "object": obj,
                "importance": round(float(d.get("importance") or 0.5), 2),
                "source": "aiji-fact",
            })
except Exception as e:
    print("查询失败:", e)

con.close()

print("从 AIJiYi 拉到 " + str(len(facts)) + " 条高重要性事实")

# 写入 her-soul 的 semantic 层（去重：保留最近 100 条）
s = json.load(open(SOUL, encoding="utf-8"))
s.setdefault("memory", {})
existing = s["memory"].get("semantic", [])

# 用 subject+predicate 去重
seen = set()
for f in existing:
    seen.add(str(f.get("subject", "")) + "|" + str(f.get("predicate", "")))

added = 0
for f in facts:
    key = f["subject"] + "|" + f["predicate"]
    if key in seen:
        continue
    existing.append(f)
    seen.add(key)
    added += 1

s["memory"]["semantic"] = existing[-100:]
json.dump(s, open(SOUL, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

print("新增 " + str(added) + " 条，semantic 层现在 " + str(len(s["memory"]["semantic"])) + " 条")
print()
print("最新 5 条:")
for f in s["memory"]["semantic"][-5:]:
    print("  " + f.get("subject", "") + " / " + f.get("predicate", "") + " = " + f.get("object", "")[:50])
