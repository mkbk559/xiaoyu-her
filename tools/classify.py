#!/usr/bin/env python3
"""
大肥鱼 冗余清理分析（2026-11-11）
分类所有文件：核心 / 辅助 / 一次性 / 垃圾
"""
import os
import re
import time

H = "/opt/her"

# ══════ 核心：不能动 ══════
CORE = {
    # 主链路
    "her-mind.mjs": "主内核（目标→计划→执行→反思）",
    "her-soul.mjs": "关系/记忆/人格/欲望",
    "her-world.mjs": "世界感知（时间/天气/日程/新闻）",
    "her-contract.mjs": "执行契约/告警/快照",
    "her-arbiter.mjs": "组合契约/仲裁优先级",
    "her-goals.mjs": "目标管理（读 her-mind.json）",
    "her-complete.mjs": "目标完成归档",
    "her-consume.mjs": "消息消费（关系/情绪/记忆更新）",
    "her-ops.mjs": "运维/健康/故障注入",
    "her-verify.mjs": "质量验证（小说/视频）",
    "her-veto.mjs": "第三份验证集（不调参）",
    # 新功能
    "her-graph.mjs": "记忆图（抄 auto-ontology）",
    "chat-log.mjs": "聊天记录落盘",
    "her-world-news.py": "热搜/新闻抓取（Scrapling）",
    # 桥接 + 服务
    "bridge.mjs": "QQ 桥（在 /opt/herqq/，这个可能在 H 下副本）",
    "her-watchdog.sh": "自愈脚本",
    "night-watch.sh": "监控记录脚本",
    # 运维工具
    "crawl-refs.py": "文献爬取（81 个）",
    "audit.py": "架构审计（本工具）",
    "check-imports.py": "import 检查（抓到过真 bug）",
    "morning-report.sh": "明早报告生成",
    "her-plugin-copy.mjs": "插件源码复制",
}

# ══════ 辅助：保留但可归档 ══════
HELPER_PATTERNS = [
    (r"^log-.*\.py$", "写 FIX-LOG 的一次性脚本"),
    (r"^test-.*\.(mjs|py|sh)$", "测试脚本"),
    (r"^check-.*\.(py|sh|mjs)$", "一次性检查脚本"),
    (r"^verify-.*\.(py|mjs|sh)$", "一次性验证"),
    (r"^sim-.*\.mjs$", "模拟脚本"),
    (r"^debug-.*\.(py|mjs)$", "调试脚本"),
    (r"^diag-.*\.(mjs|py)$", "诊断脚本"),
    (r"^fix-.*\.py$", "修 bug 的一次性补丁脚本"),
    (r"^add-.*\.py$", "加功能的一次性脚本"),
    (r"^wire-.*\.py$", "接线的一次性脚本"),
    (r"^rewrite-.*\.py$", "重写的一次性脚本"),
    (r"^archive-.*\.py$", "归档脚本"),
    (r"^clean-.*\.(py|sh|mjs)$", "清理脚本"),
    (r"^fill-.*\.py$", "填充数据脚本"),
]

# ══════ 早期试验（可删）══════
EARLY_PATTERNS = [
    (r"^(grab|dy|make|render|build|merge|login|fingerprint|chrome|remove|measure|layout|prepare|tune|scan|refs)-.*\.(mjs|py|sh)$", "早期试验（抖音/视频/图片/价格）"),
    (r"^test_brain", "早期大脑测试"),
    (r"^audit-.*\.sh$", "旧审计脚本"),
    (r"^(restore|restart|wait|final|preflight|log-fix)-.*\.(sh|py)$", "早期运维脚本"),
    (r"^her-life", "早期生活模拟"),
    (r"^her-chat", "聊天服务副本"),
    (r"^a2a-", "A2A 相关"),
    (r"^deploy-", "部署脚本"),
    (r"^check-aiji", "Aiji 检查"),
    (r"^check-plugin", "插件检查"),
    (r"^clone-skills", "克隆技能"),
    (r"^patch-", "补丁脚本"),
    (r"^clone-", "克隆脚本"),
]

def classify(name):
    if name in CORE:
        return "core", CORE[name]
    for pat, desc in EARLY_PATTERNS:
        if re.match(pat, name):
            return "early", desc
    for pat, desc in HELPER_PATTERNS:
        if re.match(pat, name):
            return "helper", desc
    return "unknown", ""

# 扫描
groups = {"core": [], "helper": [], "early": [], "unknown": []}
for f in sorted(os.listdir(H)):
    p = os.path.join(H, f)
    if not os.path.isfile(p):
        continue
    if not (f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py") or f.endswith(".js")):
        continue
    cat, desc = classify(f)
    sz = os.path.getsize(p)
    groups[cat].append((f, sz, desc))

print("════════════════════════════════════════════")
print("        冗余分类结果")
print("════════════════════════════════════════════")
print()

total_sz = 0
for cat, label in [("core", "核心（不能动）"), ("helper", "辅助（可归档）"),
                    ("early", "早期试验（可删）"), ("unknown", "未分类（要人工看）")]:
    items = groups[cat]
    sz = sum(x[1] for x in items)
    total_sz += sz
    print(f"【{label}】{len(items)} 个，{sz//1024} KB")
    if cat in ("early", "unknown"):
        for f, s, d in items:
            print(f"    {f:<34} {s:>6}B  {d}")
    print()

print(f"合计：{len(groups['core']) + len(groups['helper']) + len(groups['early']) + len(groups['unknown'])} 个脚本")
print()

# 保留清单
print("════════════════════════════════════════════")
print("        该保留的（核心）")
print("════════════════════════════════════════════")
for f, s, d in sorted(groups["core"], key=lambda x: -x[1]):
    exists = "✓" if os.path.exists(os.path.join(H, f)) else "✗"
    print(f"  {exists} {f:<26} {s:>7}B  {d}")
