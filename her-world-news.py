#!/usr/bin/env python3
"""
热搜/新闻抓取（2026-11-11，用 Scrapling + 系统 Chrome）
让她能真的"看到"外面的世界，不是只靠天气。

CLI:
  python3 her-world-news.py fetch     抓一次并缓存
  python3 her-world-news.py get       读缓存
"""
import sys
import json
import os
import time
from datetime import datetime, timezone, timedelta

CACHE = "/opt/her/her-world-news.json"
CACHE_MIN = 60   # 缓存 60 分钟

def now_cn():
    return datetime.now(timezone.utc) + timedelta(hours=8)

def fetch_hot():
    """抓百度热搜"""
    from scrapling.fetchers import StealthyFetcher
    page = StealthyFetcher.fetch(
        "https://top.baidu.com/board?tab=realtime",
        headless=True,
        timeout=60000,
        executable_path="/usr/bin/google-chrome",
    )
    titles = page.css("[class*=c-single-text]::text").extract()
    hot = []
    for x in titles:
        s = str(x).strip()
        if 4 < len(s) < 50 and s not in hot:
            hot.append(s)
    return hot[:10]

def fetch_news():
    """抓腾讯新闻"""
    from scrapling.fetchers import StealthyFetcher
    page = StealthyFetcher.fetch(
        "https://news.qq.com/",
        headless=True,
        timeout=60000,
        executable_path="/usr/bin/google-chrome",
    )
    texts = page.css("a::text").extract()
    news = []
    for x in texts:
        s = str(x).strip()
        if 10 < len(s) < 60 and s not in news:
            news.append(s)
    return news[:8]

def fetch_all():
    out = {"at": now_cn().strftime("%Y-%m-%d %H:%M:%S"), "hot": [], "news": [], "ok": False}
    try:
        out["hot"] = fetch_hot()
        out["ok"] = True
    except Exception as e:
        out["hot_err"] = str(e)[:150]
    try:
        out["news"] = fetch_news()
        out["ok"] = True
    except Exception as e:
        out["news_err"] = str(e)[:150]

    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out

def get_cached(max_age_min=CACHE_MIN):
    """读缓存，太旧就重新抓"""
    if os.path.exists(CACHE):
        try:
            j = json.load(open(CACHE, encoding="utf-8"))
            t = datetime.strptime(j["at"], "%Y-%m-%d %H:%M:%S")
            age = (now_cn().replace(tzinfo=None) - t).total_seconds() / 60
            if age < max_age_min:
                j["ageMin"] = int(age)
                return j
        except Exception:
            pass
    return fetch_all()

def brief():
    """给世界感知用的一句话"""
    j = get_cached()
    parts = []
    if j.get("hot"):
        parts.append("热搜：" + "、".join(j["hot"][:4]))
    if j.get("news"):
        parts.append("新闻：" + "、".join(j["news"][:3]))
    if not parts:
        return ""
    return "外面在说 —— " + "；".join(parts)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "get"

    if cmd == "fetch":
        j = fetch_all()
        print("抓取完成:", j["at"])
        print("  热搜:", len(j["hot"]), "条")
        for h in j["hot"][:5]:
            print("    -", h)
        print("  新闻:", len(j["news"]), "条")
        for n in j["news"][:5]:
            print("    -", n)
        if j.get("hot_err"):
            print("  热搜错误:", j["hot_err"])
        if j.get("news_err"):
            print("  新闻错误:", j["news_err"])

    elif cmd == "get":
        j = get_cached()
        print("缓存时间:", j.get("at"), "| 年龄:", j.get("ageMin", 0), "分钟")
        print("热搜:", j.get("hot", []))
        print("新闻:", j.get("news", []))

    elif cmd == "brief":
        print(brief() or "(没抓到)")
