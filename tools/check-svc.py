#!/usr/bin/env python3
"""服务健康检查（2026-11-11）"""
import subprocess

svcs = ["aiji", "her-chat", "herqq-bridge", "napcat", "xvfb-qq",
        "her-mind.timer", "her-watchdog.timer", "night-watch.timer", "her-news.timer"]

ok = 0
for s in svcs:
    r = subprocess.run(["systemctl", "is-active", s], capture_output=True, text=True)
    st = r.stdout.strip()
    if st == "active":
        ok += 1
        mark = "OK  "
    else:
        mark = "FAIL"
    print(f"  {mark} {s:<22} {st}")

print()
print(f"健康: {ok}/{len(svcs)}")
