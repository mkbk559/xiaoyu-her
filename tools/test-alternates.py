#!/usr/bin/env python3
"""测试失败 URL 的替代路径（2026-11-11）"""
import subprocess
import re

UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
]

def try_curl(url, timeout=30):
    for ua in UAS:
        r = subprocess.run(
            ["curl", "-sL", "--max-time", str(timeout), "-A", ua,
             "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
             "-H", "Accept-Language: zh-CN,zh;q=0.9", url],
            capture_output=True, text=True, errors="ignore"
        )
        body = r.stdout or ""
        if len(body) > 500:
            return len(body), body[:200]
    return 0, ""

print("════ 测试失败 URL 的替代路径 ════")
print()

# 1. hanspub PDF → 试 HTML 页面
print("[1] hanspub PDF → HTML 页")
for pid in ["ces20230900000", "ml20240300000", "ml20241212", "isl_1220552", "ml20231000000", "jc_3041018", "ml20240200000", "ap20241411"]:
    # 试几种可能的 HTML 路径
    for pat in [
        f"https://www.hanspub.org/journal/paperinformation?paperid={pid}",
        f"https://www.hanspub.org/journal/PaperInformation.aspx?paperID={pid}",
    ]:
        n, head = try_curl(pat)
        if n > 1000:
            print(f"  {pid}: ✅ {n} 字节")
            break
    else:
        print(f"  {pid}: ❌ 都失败")

print()

# 2. wikipedia → 试镜像
print("[2] wikipedia → 镜像")
for slug in ["擬劇論", "電腦中介傳播", "拼音縮寫"]:
    for base in ["https://zh.wikipedia.org/wiki/", "https://zh.m.wikipedia.org/wiki/"]:
        n, head = try_curl(base + slug)
        if n > 1000:
            print(f"  {slug}: ✅ {n} 字节 ({base})")
            break
    else:
        print(f"  {slug}: ❌ 都不通")

print()

# 3. 期刊 PDF → 试 HTML 页
print("[3] 期刊 PDF → HTML 页")
pairs = [
    ("宋琦 话轮转换时间预期", "https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2018.01001"),
    ("史汉文 情绪词", "https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2021.00001"),
    ("周倩伊 共情模拟", "https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2025.1783"),
    ("评价理论", "https://www.hanspub.org/journal/paperinformation?paperid=85944621"),
]
for name, url in pairs:
    n, head = try_curl(url)
    print(f"  {name}: {'✅ ' + str(n) + ' 字节' if n > 1000 else '❌'}")
