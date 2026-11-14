#!/usr/bin/env python3
"""
爬取《人是怎么说话的》笔记里所有文献网址（2026-11-11）

用户要求：「需要去爬取网址，直接全部学习落位」

策略：
1. 逐个 URL 用 Scrapling 抓（HTML 直接抓文本，PDF 用 curl 下载后 pypdf 解析）
2. 存成 /opt/her/knowledge/<序号>-<slug>.md
3. 失败记录到 /opt/her/knowledge/_failed.json
4. 最后生成索引 /opt/her/knowledge/INDEX.md

CLI:
  python3 crawl-refs.py all        爬全部
  python3 crawl-refs.py one <url>  爬一个
  python3 crawl-refs.py index      重建索引
"""
import sys
import os
import json
import time
import re
import hashlib
from datetime import datetime, timezone, timedelta

KNOW = "/opt/her/knowledge"
FAILED = os.path.join(KNOW, "_failed.json")
INDEX = os.path.join(KNOW, "INDEX.md")

def now_cn():
    return datetime.now(timezone.utc) + timedelta(hours=8)

# ══════ 所有文献网址（从笔记里提取）══════
REFS = [
    # 1. 会话分析
    ("会话分析", "吴亚欣《会话分析：研究问题、语料、视角及发现》", "https://www.researchgate.net/publication/405109173"),
    ("会话分析", "吴亚欣、于国栋《为会话分析正名》", "https://www.researchgate.net/publication/326466225"),
    ("会话分析", "赵万里、范宏雅《常人方法论的谈话分析》", "http://sociologyol.ruc.edu.cn/shxyj/shxyjff/d65aa1277ed643c69c7c7847cb487968.htm"),
    ("会话分析", "黄丹翎《确认型重复作为话轮转换的互动会话功能》", "https://dr.ntu.edu.sg/entities/publication/69745d04-11d4-49fa-a2fa-486a25360334"),
    ("会话分析", "宋琦《话轮转换中的时间预期》", "https://journal.psych.ac.cn/xlkxjz/EN/article/downloadArticleFile.do?attachType=PDF&id=7610"),

    # 2. 互动语言学与汉语口语
    ("互动语言学", "方梅《汉语自然口语对话的互动语言学研究》项目", "http://ling.cass.cn/keyan/yanjiuxiangmu/gjjxm/202110/t20211029_5370347.html"),
    ("互动语言学", "《汉语自然口语对话中单句的合作共建研究》", "http://ling.cass.cn/jiaoxue/xwlwzy/boshilunwen/202308/t20230824_5681142.html"),
    ("互动语言学", "《中国语言学年鉴2022：篇章语用研究综述》", "http://ling.cass.cn/ziyuan/jikannianjian/2022/202311/t20231103_5694705.html"),
    ("互动语言学", "刘丹青《话题类型与主句现象》", "https://www.bfsujournals.com/c/2023-02-15/516479.shtml"),
    ("互动语言学", "史有为《零句论述质疑》", "https://xbzs.ecnu.edu.cn/article/2020/1000-5579/2020-6-62.htm"),

    # 3. 语用与言语行为
    ("语用", "奥斯汀言语行为理论", "https://baike.baidu.com/item/%E8%A8%80%E8%AF%AD%E8%A1%8C%E4%B8%BA%E7%90%86%E8%AE%BA/10898290"),
    ("语用", "塞尔言语行为分类", "http://www.gongfa.com/yanyuxingweililun.htm"),
    ("语用", "《述评奥斯汀及塞尔的言语行为理论》", "https://www.hanspub.org/journal/paperinformation?paperid=92505"),
    ("语用", "薛冰 Grice 合作原则与会话含义", "https://pdf.hanspub.org/ces20230900000_94068241.pdf"),
    ("语用", "徐盛桓《含义与推理》", "https://html.rhhz.net/HNLGDXXBSKB/html/20170312.htm"),
    ("语用", "间接言语行为", "https://baike.baidu.com/item/%E9%97%B4%E6%8E%A5%E8%A8%80%E8%AF%AD%E8%A1%8C%E4%B8%BA/2721792"),
    ("语用", "礼貌策略", "https://baike.baidu.com/item/%E7%A4%BC%E8%B2%8C%E7%AD%96%E7%95%A5/56092265"),

    # 4. 情绪与立场
    ("情绪立场", "刘娟《情感语言学》", "https://www.sinoss.net/uploadfile/2010/1130/7677.pdf"),
    ("情绪立场", "史汉文《区分情绪标签词和情绪负载词》", "https://journal.psych.ac.cn/xlkxjz/CN/article/downloadArticleFile.do?attachType=PDF&id=6440"),
    ("情绪立场", "方梅、乐耀《规约化与立场表达》", "http://ling.cass.cn/keyan/xueshuchengguo/cgtj/202112/t20211209_5380345.html"),
    ("情绪立场", "评价理论（Martin & White）", "https://pdf.hanspub.org/ml20240300000_85944621.pdf"),
    ("情绪立场", "《汉语句末语气词在反语认知中的作用》", "https://ejournal.upsi.edu.my/ERUDITE/article/download/3425/2492"),
    ("情绪立场", "郑曼君《华语反话策略》", "https://www.airitilibrary.com/Article/Detail/U0021-NTNU47753"),

    # 5. 称呼与语域
    ("称呼语域", "《现代汉语称谓系统的分类标准与功能分析》", "https://xbzs.ecnu.edu.cn/CN/article/downloadArticleFile.do?attachType=PDF&id=12900"),
    ("称呼语域", "《现代汉语背称的系统功能框架》", "http://jfl.shisu.edu.cn/en/article/pdf/preview/348c4e12-fc68-4165-ab7f-3106ffd8928d.pdf"),
    ("称呼语域", "《网络称呼语的前世今生》", "https://news.gmw.cn/2025-05/11/content_38018066.htm"),
    ("称呼语域", "语域理论（语场、语旨、语式）", "https://pdf.hanspub.org/ml20241212_502914181.pdf"),
    ("称呼语域", "陈新仁《语用身份与交际研究》", "https://www.hanspub.org/journal/paperinformation?paperid=90617"),
    ("称呼语域", "Hall 身份建构原则", "https://sdsk.sdxc.gov.cn/show/979.html"),

    # 6. 语气词与话语标记
    ("语气词", "《语气词功能新探》", "https://ccj.pku.edu.cn/Article/DownLoad?id=770099287101509&type=ArticleFile"),
    ("语气词", "陈振宁、陈振宇《呢系语气词话题问功能》", "https://www.cuhk.edu.hk/ics/clrc/crcl_101_2/chen.pdf"),
    ("语气词", "王琦《语气词嘶的会话分析》", "https://www.fcipub.org/articleDetail/2691?periodicalId=7"),
    ("语气词", "《语用小品词呢的位置分布与互动功能》", "https://www.researchgate.net/publication/390812898"),
    ("语气词", "刘远文《话语标记就是》", "https://www.airitilibrary.com/Article/Detail/U0021-G060684002I"),
    ("语气词", "李思旭《话语标记的形成机制与前沿课题》", "https://jfl.shisu.edu.cn/cn/article/pdf/preview/716.pdf"),

    # 7. 修正与停顿
    ("修正停顿", "《汉语二语课堂会话修正策略探究》", "https://xbzs.ecnu.edu.cn/CN/html/201601012.htm"),
    ("修正停顿", "李洙旼《以华语母语者日常会话语料为本的自我发起自我修补》", "https://www.airitilibrary.com/Article/Detail/U0021-1120230804206015"),
    ("修正停顿", "《就是作为自我修正前言》", "https://www.researchgate.net/publication/392442764"),
    ("修正停顿", "《中文谈话中的停顿类型之语言分析》", "https://www.airitilibrary.com/Article/Detail/U0001-1129250203522006"),

    # 8. 网络与键盘说话
    ("网络说话", "《数字媒介下公共话语非正式语体的变迁机制》", "https://pdf.hanspub.org/isl_1220552.pdf"),
    ("网络说话", "电脑中介传播 CMC", "https://zh.wikipedia.org/zh-hans/%E9%9B%BB%E8%85%A6%E4%B8%AD%E4%BB%8B%E5%82%B3%E6%92%AD"),
    ("网络说话", "《网络语言对汉语的影响和前景分析》教育部", "http://www.moe.gov.cn/jyb_xwfb/xw_ft/moe_46/moe_1055/tnull_11604.html"),
    ("网络说话", "中文网络流行语的特征（经济性）", "https://jfafu.journals.ekb.eg/article_332393.pdf"),

    # 9. 关系与亲密语言
    ("亲密语言", "舒雨萌《亲密关系言外之意的对比分析》", "https://www.fcipub.org/articleDetail/4150?periodicalId=3"),
    ("亲密语言", "《为什么东亚语言里才有撒娇这个词》", "https://example.com/question/423115205"),

    # 10. 接住一个人
    ("情感支持", "《迈向情感支持对话系统》ESConv", "https://www.alphaxiv.org/zh/abs/2106.01144"),
    ("情感支持", "周倩伊《大语言模型的共情模拟》", "https://journal.psych.ac.cn/xlkxjz/CN/10.3724/SP.J.1042.2025.1783"),
    ("情感支持", "上海交大赵冰蕾、金耀辉团队研究", "https://psychology.sjtu.edu.cn/xsdt/478.html"),
    ("情感支持", "《可视的倾听：网络直播的情感支持研究》", "https://www.fcipub.org/articleDetail/3222?periodicalId=6"),

    # 11. AI 与人说话的差异
    ("AI差异", "Rodrigues (2026) 人与AI内容语言学对比", "https://pmc.ncbi.nlm.nih.gov/articles/PMC12969083/"),
    ("AI差异", "Georgiou (2024) 区分人写与AI生成文本", "https://arxiv.org/abs/2407.03646"),
    ("AI差异", "Pangram《LLM不仅仅是模仿人类文本》", "https://www.pangram.com/zh/blog/no-llms-dont-just-mimic-human-text"),
    ("AI差异", "《大模型也冲奥斯卡：AI角色扮演全景综述》", "https://hub.baai.ac.cn/view/40756"),
    ("AI差异", "《个性化大模型技术实践》", "http://www.sccio.cn/uploads/20241029/0f5589cecade1c27f8531e34dbbb1247.pdf"),
    ("AI差异", "《人工智能拟人化互动服务管理暂行办法》", "https://www.cac.gov.cn/2025-12/28/c_1768662848000498.htm"),
    ("AI差异", "《给AI陪伴划定安全边界》人民日报", "https://paper.people.com.cn/rmrbhwb/pc/content/202608/21/content_30176220.html"),

    # 拓展一：网络语言
    ("网络语言", "《中国大陆网络语言》论经济性", "https://lup.lub.lu.se/student-papers/record/1671696/file/1671697.pdf"),
    ("网络语言", "张怡微《汉语网络流行语我X了构式研究》", "https://pdf.hanspub.org/ml20231000000_15901473.pdf"),
    ("网络语言", "《网络流行语的语言特征及传播分析》", "https://www.researchgate.net/publication/411025583"),
    ("网络语言", "《迷因理论视域下抖音热梗生成与传播机制》", "https://pdf.hanspub.org/jc_3041018.pdf"),
    ("网络语言", "《论网络语言的社群化》", "https://www.researchgate.net/publication/396463290"),
    ("网络语言", "黄婧《弹幕视频的实时互动性与会话机制》", "http://xb.xynu.edu.cn/cn/article/pdf/preview/10.3969/j.issn.1003-0964.2024.02.017.pdf"),
    ("网络语言", "许峻峰《B站弹幕语言的发展》", "https://pdf.hanspub.org/ml20240200000_55468049.pdf"),
    ("网络语言", "《表情符号研究综述及展望》", "https://qks.sufe.edu.cn/j/PDFFull/A0wgjjygl-2022-4-106.pdf"),
    ("网络语言", "《作为图像行为的表情包》", "https://www.cssn.cn/xwcbx/202208/t20220802_5440109.shtml"),
    ("网络语言", "拼音缩写", "https://zh.wikipedia.org/zh-hans/%E6%8B%BC%E9%9F%B3%E7%B8%AE%E5%AF%AB"),
    ("网络语言", "《网络暴力语言的特征与治理》", "https://www.researchgate.net/publication/397672379"),
    ("网络语言", "《网络热梗背后的青年群体社会心态探析》人民日报", "https://paper.people.com.cn/rmlt/pc/content/202410/16/content_30030026.html"),
    ("网络语言", "《网络流行语的演化迭代、言语实践与价值评判》", "https://www.rmlt.com.cn/2023/0302/667213.shtml"),

    # 拓展二：网络塑造人
    ("网络塑造", "戈夫曼拟剧论", "https://zh.wikipedia.org/zh-hans/%E6%93%AC%E5%8A%87%E8%AB%96"),
    ("网络塑造", "胡曼婷《拟剧理论视角下大学生社交媒体自我呈现》", "https://pdf.hanspub.org/ap20241411_341135212.pdf"),
    ("网络塑造", "霍根：网络自我呈现从表演变成陈列", "https://example.com/p/580878969"),
    ("网络塑造", "陈昌凤《算法一定制造信息茧房吗》清华", "https://www.tsinghua.edu.cn/info/1662/113104.htm"),
    ("网络塑造", "《信息茧房研究综述》", "https://www.lis.ac.cn/CN/article/downloadArticleFile.do?attachType=PDF&id=24287"),
    ("网络塑造", "《中央网信办持续加强信息推荐算法治理》", "https://www.cac.gov.cn/2025-05/22/c_1749536203490537.htm"),
    ("网络塑造", "《短视频成瘾对注意网络功能的影响》", "https://www.hanspub.org/journal/paperinformation?paperid=112562"),
    ("网络塑造", "《算法推荐下社交媒体用户负向情绪扩散机理》", "https://www.hanspub.org/journal/paperinformation?paperid=120200"),
    ("网络塑造", "张亚利《社交媒体使用与错失焦虑的关系》心理学报", "https://journal.psych.ac.cn/xlxb/article/2021/0439-755X/0439-755X-53-3-273.shtml"),
    ("网络塑造", "《微信使用中的孤独感研究》", "http://xwcbpl.whu.edu.cn/e/public/DownFile/?id=324&classid=9"),
    ("网络塑造", "《弱连接和强关系：浅析点赞社交的动机与维系》", "https://www.pressreader.com/china/media-5898/20191030/282299616962229"),
    ("网络塑造", "《社交媒体中点赞行为的多维度研究》人民网", "http://media.people.com.cn/n1/2017/0921/c414426-29550231.html"),
]

def slug(text):
    """生成文件名"""
    h = hashlib.md5(text.encode("utf-8")).hexdigest()[:8]
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text)[:40]
    return f"{s}-{h}"

def is_pdf(url):
    return url.lower().endswith(".pdf") or "downloadArticleFile" in url or "PDFFull" in url or "/pdf/" in url

# 被墙/已知抓不了的域名（2026-11-11 诊断）
BLOCKED_DOMAINS = ["wikipedia.org", "researchgate.net"]

UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
]

def is_blocked(url):
    return any(d in url for d in BLOCKED_DOMAINS)

def fetch_curl_html(url):
    """curl + html 解析（Scrapling 失败时的回退）"""
    import subprocess
    for ua in UAS:
        r = subprocess.run(
            ["curl", "-sL", "--max-time", "40", "-A", ua,
             "-H", "Accept-Language: zh-CN,zh;q=0.9",
             url],
            capture_output=True, text=True, errors="ignore"
        )
        html = r.stdout or ""
        if len(html) > 800:
            # 去脚本/样式
            import re as _re
            html = _re.sub(r"<script[\s\S]*?</script>", " ", html, flags=_re.I)
            html = _re.sub(r"<style[\s\S]*?</style>", " ", html, flags=_re.I)
            # 去标签
            text = _re.sub(r"<[^>]+>", "\n", html)
            text = _re.sub(r"&nbsp;", " ", text)
            text = _re.sub(r"&[a-z]+;", " ", text)
            text = _re.sub(r"\n{3,}", "\n\n", text).strip()
            if len(text) > 300:
                return 200, text
        time.sleep(1)
    return 0, "(curl 也拿不到)"

def fetch_html(url):
    """用 Scrapling 抓 HTML 正文，失败回退 curl"""
    if is_blocked(url):
        return 0, "(域名被墙/反爬，跳过)"

    # 先试 Scrapling
    try:
        from scrapling.fetchers import StealthyFetcher
        page = StealthyFetcher.fetch(url, headless=True, timeout=60000,
                                      executable_path="/usr/bin/google-chrome")
        # 优先用 markdown（保留结构）
        try:
            md = page.markdown
            if md and len(str(md)) > 200:
                return page.status, str(md)
        except Exception:
            pass
        try:
            txt = page.get_all_text()
            if txt and len(str(txt).strip()) > 200:
                return page.status, str(txt)
        except Exception:
            pass
    except Exception as e:
        pass

    # 回退 curl
    return fetch_curl_html(url)

def fetch_pdf(url):
    """PDF：多 UA 重试下载，再用 pypdf 解析"""
    import subprocess
    if is_blocked(url):
        return 0, "(域名被墙/反爬，跳过)"
    tmp = "/tmp/_ref.pdf"
    last_code = 0
    for ua in UAS:
        r = subprocess.run(["curl", "-sL", "--max-time", "90", "-A", ua,
                            "-H", "Accept: application/pdf,*/*",
                            "-o", tmp, url], capture_output=True)
        if os.path.exists(tmp) and os.path.getsize(tmp) > 5000:
            # 检查是不是 PDF
            with open(tmp, "rb") as f:
                head = f.read(4)
            if head == b"%PDF":
                break
        time.sleep(1)
    else:
        return 0, "(下载失败，可能 403)"

    try:
        from pypdf import PdfReader
        rd = PdfReader(tmp)
        pages = []
        for pg in rd.pages[:30]:
            try:
                pages.append(pg.extract_text() or "")
            except Exception:
                pass
        text = "\n".join(pages)
        os.remove(tmp)
        if len(text.strip()) < 100:
            return 0, "(PDF 解析出来是空的)"
        return 200, text
    except Exception as e:
        try: os.remove(tmp)
        except Exception: pass
        return 0, f"(PDF 解析失败: {str(e)[:60]})"

def crawl_one(category, title, url):
    """爬一个 URL，返回 (ok, path, chars, err)"""
    os.makedirs(KNOW, exist_ok=True)
    name = f"{slug(title)}.md"
    path = os.path.join(KNOW, name)

    # 已存在就跳过
    if os.path.exists(path) and os.path.getsize(path) > 300:
        return True, path, os.path.getsize(path), "(已存在)"

    try:
        if is_pdf(url):
            status, text = fetch_pdf(url)
        else:
            status, text = fetch_html(url)
    except Exception as e:
        return False, None, 0, str(e)[:150]

    if not text or len(text.strip()) < 100:
        return False, None, 0, f"内容太少（status={status}, len={len(text) if text else 0}）"

    # 清理
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    text = text[:30000]  # 每篇最多 3 万字

    md = f"""# {title}

- 分类：{category}
- 来源：{url}
- 抓取时间：{now_cn().strftime("%Y-%m-%d %H:%M:%S")}
- 字符数：{len(text)}

---

{text}
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    return True, path, len(text), ""

def load_failed():
    if os.path.exists(FAILED):
        try:
            return json.load(open(FAILED, encoding="utf-8"))
        except Exception:
            pass
    return {}

def save_failed(d):
    os.makedirs(KNOW, exist_ok=True)
    json.dump(d, open(FAILED, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def crawl_all():
    failed = load_failed()
    ok_n, fail_n = 0, 0
    total_n = len(REFS)

    for i, (cat, title, url) in enumerate(REFS, 1):
        print(f"[{i}/{total_n}] {title[:35]}")
        ok, path, chars, err = crawl_one(cat, title, url)
        if ok:
            ok_n += 1
            print(f"  ✓ {chars} 字符")
            failed.pop(url, None)
        else:
            fail_n += 1
            print(f"  ✗ {err}")
            failed[url] = {"title": title, "category": cat, "err": err,
                           "at": now_cn().strftime("%Y-%m-%d %H:%M:%S")}
        save_failed(failed)
        time.sleep(1.5)  # 别打太快

    print()
    print(f"════ 完成：成功 {ok_n} / 失败 {fail_n} / 总共 {total_n} ════")
    build_index()

def build_index():
    os.makedirs(KNOW, exist_ok=True)
    files = sorted([f for f in os.listdir(KNOW) if f.endswith(".md") and f != "INDEX.md"])
    by_cat = {}
    for f in files:
        p = os.path.join(KNOW, f)
        try:
            head = open(p, encoding="utf-8").read(600)
        except Exception:
            continue
        m = re.search(r"^# (.+)$", head, re.M)
        title = m.group(1) if m else f
        m2 = re.search(r"^- 分类：(.+)$", head, re.M)
        cat = m2.group(1) if m2 else "其他"
        m3 = re.search(r"^- 字符数：(\d+)$", head, re.M)
        chars = int(m3.group(1)) if m3 else 0
        by_cat.setdefault(cat, []).append((title, f, chars))

    failed = load_failed()
    lines = [f"# 知识库索引\n", f"更新：{now_cn().strftime('%Y-%m-%d %H:%M:%S')}\n",
             f"共 {len(files)} 篇，{sum(len(v) for v in by_cat.values())} 条\n"]
    for cat in sorted(by_cat):
        items = by_cat[cat]
        lines.append(f"\n## {cat}（{len(items)} 篇）\n")
        for t, f, c in sorted(items, key=lambda x: -x[2]):
            lines.append(f"- [{t}]({f}) — {c} 字\n")
    if failed:
        lines.append(f"\n## 抓取失败（{len(failed)} 个）\n")
        for url, info in failed.items():
            lines.append(f"- {info.get('title','?')} — {info.get('err','?')[:60]}\n")

    open(INDEX, "w", encoding="utf-8").write("".join(lines))
    print(f"索引已生成：{INDEX}")
    return len(files)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "all":
        crawl_all()
    elif cmd == "one":
        url = sys.argv[2]
        ok, path, chars, err = crawl_one("手动", url, url)
        print(ok, path, chars, err)
    elif cmd == "index":
        n = build_index()
        print(f"索引里有 {n} 篇")
    elif cmd == "list":
        print(f"共 {len(REFS)} 个参考文献：")
        for i, (cat, title, url) in enumerate(REFS, 1):
            print(f"  {i}. [{cat}] {title}")
            print(f"     {url}")
