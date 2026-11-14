#!/usr/bin/env python3
"""测失败 URL 的替代路径（2026-11-11，简化版）"""
import subprocess

def code(url, timeout=15):
    r = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
         "--max-time", str(timeout), "-A",
         "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
         url],
        capture_output=True, text=True
    )
    return r.stdout.strip() or "TIMEOUT"

print("════ hanspub HTML 页 ════")
for pid in ["94068241", "85944621", "15901473", "55468049", "341135212"]:
    u = "https://www.hanspub.org/journal/paperinformation?paperid=" + pid
    print(f"  paperid={pid} → {code(u)}")

print()
print("════ wikipedia 镜像 ════")
for u in [
    "https://zh.m.wikipedia.org/wiki/%E6%93%AC%E5%8A%87%E8%AB%96",
    "https://zh.wikipedia.org/wiki/%E6%93%AC%E5%8A%87%E8%AB%96",
    "https://zh.wikipedia.org/zh-cn/%E6%93%AC%E5%8A%87%E8%AB%96",
]:
    print(f"  {u[:60]} → {code(u, 10)}")

print()
print("════ 期刊 HTML 页 ════")
tests = [
    ("心理学报 错失焦虑", "https://journal.psych.ac.cn/xlxb/article/2021/0439-755X/0439-755X-53-3-273.shtml"),
    ("心理学报 共情模拟", "https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2025.1783"),
    ("新闻与传播评论", "http://xwcbpl.whu.edu.cn/e/public/DownFile/?id=324&classid=9"),
]
for name, u in tests:
    print(f"  {name} → {code(u, 20)}")
