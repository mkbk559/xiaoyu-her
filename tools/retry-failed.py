#!/usr/bin/env python3
"""
补救爬取失败的文献（2026-11-11）
用 HTML 页替代 PDF，用不同 URL 模式
"""
import os
import re
import json
import subprocess
import hashlib
from datetime import datetime, timezone, timedelta

KNOW = "/opt/her/knowledge"
UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
]

def now_cn():
    return datetime.now(timezone.utc) + timedelta(hours=8)

def slug(text):
    h = hashlib.md5(text.encode("utf-8")).hexdigest()[:8]
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text)[:40]
    return f"{s}-{h}"

def fetch_curl(url, timeout=40):
    for ua in UAS:
        r = subprocess.run(
            ["curl", "-sL", "--max-time", str(timeout), "-A", ua,
             "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
             "-H", "Accept-Language: zh-CN,zh;q=0.9", url],
            capture_output=True, text=True, errors="ignore"
        )
        body = r.stdout or ""
        if len(body) > 800:
            # 清理
            b = re.sub(r"<script[\s\S]*?</script>", " ", body, flags=re.I)
            b = re.sub(r"<style[\s\S]*?</style>", " ", b, flags=re.I)
            text = re.sub(r"<[^>]+>", "\n", b)
            text = re.sub(r"&nbsp;", " ", text)
            text = re.sub(r"&[a-z]+;", " ", text)
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
            if len(text) > 300:
                return 200, text
        import time
        time.sleep(1)
    return 0, ""

def save(title, category, url, text):
    os.makedirs(KNOW, exist_ok=True)
    name = f"{slug(title)}.md"
    path = os.path.join(KNOW, name)
    text = text[:30000]
    md = f"""# {title}

- 分类：{category}
- 来源：{url}
- 抓取时间：{now_cn().strftime("%Y-%m-%d %H:%M:%S")}
- 字符数：{len(text)}

---

{text}
"""
    open(path, "w", encoding="utf-8").write(md)
    return path, len(text)

# ══════ 补救清单：(分类, 标题, 原始URL, 替代URL列表) ══════
RETRY = [
    # hanspub PDF → HTML 页
    ("语用", "薛冰 Grice 合作原则与会话含义", "https://pdf.hanspub.org/ces20230900000_94068241.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=94068241"]),
    ("情绪立场", "评价理论（Martin & White）", "https://pdf.hanspub.org/ml20240300000_85944621.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=85944621"]),
    ("称呼语域", "语域理论（语场、语旨、语式）", "https://pdf.hanspub.org/ml20241212_502914181.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=502914181"]),
    ("网络说话", "《数字媒介下公共话语非正式语体的变迁机制》", "https://pdf.hanspub.org/isl_1220552.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=1220552"]),
    ("网络语言", "张怡微《汉语网络流行语我X了构式研究》", "https://pdf.hanspub.org/ml20231000000_15901473.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=15901473"]),
    ("网络语言", "《迷因理论视域下抖音热梗生成与传播机制》", "https://pdf.hanspub.org/jc_3041018.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=3041018"]),
    ("网络语言", "许峻峰《B站弹幕语言的发展》", "https://pdf.hanspub.org/ml20240200000_55468049.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=55468049"]),
    ("网络塑造", "胡曼婷《拟剧理论视角下大学生社交媒体自我呈现》", "https://pdf.hanspub.org/ap20241411_341135212.pdf",
     ["https://www.hanspub.org/journal/paperinformation?paperid=341135212"]),

    # 期刊
    ("网络塑造", "张亚利《社交媒体使用与错失焦虑的关系》心理学报", "https://journal.psych.ac.cn/xlxb/article/2021/0439-755X/0439-755X-53-3-273.shtml",
     ["https://journal.psych.ac.cn/xlxb/article/2021/0439-755X/0439-755X-53-3-273.shtml"]),
    ("情感支持", "周倩伊《大语言模型的共情模拟》", "https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2025.1783",
     ["https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2025.1783"]),
    ("网络塑造", "《微信使用中的孤独感研究》", "http://xwcbpl.whu.edu.cn/e/public/DownFile/?id=324&classid=9",
     ["http://xwcbpl.whu.edu.cn/e/public/DownFile/?id=324&classid=9"]),

    # 其他可能能救的
    ("会话分析", "宋琦《话轮转换中的时间预期》", "https://journal.psych.ac.cn/xlkxjz/EN/article/downloadArticleFile.do?attachType=PDF&id=7610",
     ["https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2019.00001"]),
    ("情绪立场", "史汉文《区分情绪标签词和情绪负载词》", "https://journal.psych.ac.cn/xlkxjz/CN/article/downloadArticleFile.do?attachType=PDF&id=6440",
     ["https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2020.00001"]),
    ("语气词", "陈振宁、陈振宇《呢系语气词话题问功能》", "https://www.cuhk.edu.hk/ics/clrc/crcl_101_2/chen.pdf",
     ["https://www.cuhk.edu.hk/ics/clrc/crcl_101_2/chen.pdf"]),
    ("称呼语域", "《现代汉语背称的系统功能框架》", "http://jfl.shisu.edu.cn/en/article/pdf/preview/348c4e12-fc68-4165-ab7f-3106ffd8928d.pdf",
     ["http://jfl.shisu.edu.cn/en/article/pdf/preview/348c4e12-fc68-4165-ab7f-3106ffd8928d.pdf"]),
    ("语气词", "李思旭《话语标记的形成机制与前沿课题》", "https://jfl.shisu.edu.cn/cn/article/pdf/preview/716.pdf",
     ["https://jfl.shisu.edu.cn/cn/article/pdf/preview/716.pdf"]),
    ("称呼语域", "《现代汉语称谓系统的分类标准与功能分析》", "https://xbzs.ecnu.edu.cn/CN/article/downloadArticleFile.do?attachType=PDF&id=12900",
     ["https://xbzs.ecnu.edu.cn/CN/html/201601012.htm"]),
    ("网络语言", "黄婧《弹幕视频的实时互动性与会话机制》", "http://xb.xynu.edu.cn/cn/article/pdf/preview/10.3969/j.issn.1003-0964.2024.02.017.pdf",
     ["http://xb.xynu.edu.cn/cn/article/pdf/preview/10.3969/j.issn.1003-0964.2024.02.017.pdf"]),
    ("网络语言", "《表情符号研究综述及展望》", "https://qks.sufe.edu.cn/j/PDFFull/A0wgjjygl-2022-4-106.pdf",
     ["https://qks.sufe.edu.cn/j/PDFFull/A0wgjjygl-2022-4-106.pdf"]),
    ("网络塑造", "《信息茧房研究综述》", "https://www.lis.ac.cn/CN/article/downloadArticleFile.do?attachType=PDF&id=24287",
     ["https://www.lis.ac.cn/CN/article/downloadArticleFile.do?attachType=PDF&id=24287"]),
    ("AI差异", "《个性化大模型技术实践》", "http://www.sccio.cn/uploads/20241029/0f5589cecade1c27f8531e34dbbb1247.pdf",
     ["http://www.sccio.cn/uploads/20241029/0f5589cecade1c27f8531e34dbbb1247.pdf"]),
    ("网络说话", "中文网络流行语的特征（经济性）", "https://jfafu.journals.ekb.eg/article_332393.pdf",
     ["https://jfafu.journals.ekb.eg/article_332393.pdf"]),
]

def main():
    print(f"════ 补救 {len(RETRY)} 个 ════")
    ok_n, fail_n = 0, 0
    for i, (cat, title, orig, alts) in enumerate(RETRY, 1):
        print(f"[{i}/{len(RETRY)}] {title[:35]}")
        got = False
        for alt in alts:
            status, text = fetch_curl(alt)
            if text and len(text) > 300:
                path, chars = save(title, cat, alt, text)
                print(f"  ✓ {chars} 字符 ← {alt[:60]}")
                ok_n += 1
                got = True
                break
        if not got:
            print(f"  ✗ 还是失败")
            fail_n += 1
        import time
        time.sleep(1)

    print()
    print(f"════ 补救完成：成功 {ok_n} / 失败 {fail_n} ════")

    # 重建索引
    import importlib.util
    spec = importlib.util.spec_from_file_location("crawl", "/opt/her/crawl-refs.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.build_index()

if __name__ == "__main__":
    main()
