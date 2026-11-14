#!/usr/bin/env python3
"""
大肥鱼 清理（2026-11-11 修正版）
移动到 _archive/，可回滚。
"""
import os
import sys
import shutil
from datetime import datetime, timezone, timedelta

H = "/opt/her"
ARCHIVE = os.path.join(H, "_archive")

def now_cn():
    return datetime.now(timezone.utc) + timedelta(hours=8)

# ══════ 保留清单（明确要留的）══════
KEEP = {
    # ── 主链路核心 ──
    "her-mind.mjs", "her-soul.mjs", "her-world.mjs", "her-contract.mjs",
    "her-arbiter.mjs", "her-goals.mjs", "her-complete.mjs", "her-consume.mjs",
    "her-ops.mjs", "her-verify.mjs", "her-veto.mjs", "her-graph.mjs",
    "write-novel.mjs", "daily-toon.mjs", "compose-toon.mjs",
    # ── 桥接/服务 ──
    "bridge.mjs", "chat-server.mjs", "chat-log.mjs",
    "her-watchdog.sh", "night-watch.sh", "her-world-news.py",
    # ── day.mjs 链路（被 systemd 引用）──
    "day.mjs", "events.mjs", "world.mjs", "plan.mjs", "learn.mjs",
    "self-learn.mjs", "video-learn.mjs", "bili-learn.mjs", "explore.mjs",
    "brain.mjs", "her-being.mjs", "her-personality.mjs", "her-proactive.mjs",
    "her-endo.mjs", "her-ledger.mjs", "wallet.mjs", "boss.mjs",
    "dy-library.mjs", "prepare-publish.mjs", "her-plugin-copy.mjs",
    # ── 工具（手动调用，要留）──
    "audit.py", "classify.py", "check-imports.py", "check-refs.py",
    "reachability.py", "crawl-refs.py", "fill-semantic.py", "cleanup.py",
    "morning-report.sh", "full-status.py", "scan-bugs.mjs",
}

# ══════ 明确要归档的前缀 ══════
ARCHIVE_PREFIX = [
    "log-", "log_",
    "test-", "test_",
    "make-", "render-", "layout-", "measure-", "remove-bg", "merge-cookies",
    "build-cast", "fingerprint-check", "chrome-guard",
    "shorts.mjs", "vlog.mjs", "video.mjs", "pixel-vlog", "order-vlog",
    "ledger-vlog", "dialog-vlog", "storylines", "screencast", "content-stats",
    "token-pricing", "quiet.mjs", "mem-guard", "mcp.mjs", "gw-image",
    "gen-her", "probe1", "publish", "export-cookies", "export-for-publish",
    "hunt.mjs", "jd.mjs", "work.mjs", "capability.mjs", "gate.mjs",
    "act.mjs", "make.mjs", "study-layout", "learn-batch", "bili-study",
    "dy-", "grab-",
    "preflight", "restore-run", "restart-run", "wait-check", "final-check",
    "watch.sh", "clean-browser", "clean-today",
    "deploy-", "patch-", "clone-", "a2a-", "check-aiji", "check-plugin",
    "her-life", "her-chat", "login-", "refs-scan", "refs-to-curriculum",
    "tune-detector", "sim-night", "audit-",
    "check-15", "check-16", "check-qq", "check-consec", "check-trace",
    "debug-", "diag-", "fix-", "add-", "wire-", "rewrite-", "archive-bug",
    "log-fix", "content.mjs",
]

def should_archive(name):
    if name in KEEP:
        return False
    for pat in ARCHIVE_PREFIX:
        if name.startswith(pat):
            return True
    return False

def plan():
    to_archive, to_keep = [], []
    for f in sorted(os.listdir(H)):
        p = os.path.join(H, f)
        if not os.path.isfile(p):
            continue
        if not (f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py") or f.endswith(".js")):
            continue
        (to_archive if should_archive(f) else to_keep).append(f)

    print("════════ 清理计划 ════════")
    print(f"\n【归档】{len(to_archive)} 个")
    total = 0
    for f in to_archive:
        sz = os.path.getsize(os.path.join(H, f))
        total += sz
        print(f"  → {f}")
    print(f"\n【保留】{len(to_keep)} 个")
    for f in to_keep:
        print(f"  ✓ {f}")
    print(f"\n归档合计：{len(to_archive)} 个，{total//1024} KB")

def do_archive():
    d = os.path.join(ARCHIVE, now_cn().strftime("%Y%m%d-%H%M%S"))
    os.makedirs(d, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(H)):
        p = os.path.join(H, f)
        if not os.path.isfile(p):
            continue
        if not (f.endswith(".mjs") or f.endswith(".sh") or f.endswith(".py") or f.endswith(".js")):
            continue
        if should_archive(f):
            shutil.move(p, os.path.join(d, f))
            n += 1
    print(f"已归档 {n} 个文件到 {d}")
    print(f"撤销：python3 cleanup.py undo {d}")

def undo(path=None):
    dirs = [path] if path else ([os.path.join(ARCHIVE, x) for x in sorted(os.listdir(ARCHIVE))] if os.path.isdir(ARCHIVE) else [])
    n = 0
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            src, dst = os.path.join(d, f), os.path.join(H, f)
            if not os.path.exists(dst):
                shutil.move(src, dst)
                n += 1
    print(f"已撤销 {n} 个文件")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if cmd == "plan":
        plan()
    elif cmd == "do":
        do_archive()
    elif cmd == "undo":
        undo(sys.argv[2] if len(sys.argv) > 2 else None)
