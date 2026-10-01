#!/usr/bin/env python
"""RAG 准确度基准测试 · 第一步：从公开来源抓 100 篇**不同领域、不同质量**的文档，
转成 Ametrine 知识库支持的格式（UTF-8 Markdown），显式保存到磁盘。

产物（全部留在本地，方便你在界面上手动重传、手动提问）：

    rag-bench/corpus/<domain>/<id>.md      100 篇正文
    rag-bench/MANIFEST.json                每篇的来源、领域、语言、字数、质量档、指纹
    rag-bench/MANIFEST.md                  同一份内容的人读索引
    rag-bench/build.log                    抓取过程的逐条结果（含失败的与原因）

设计上的三条坚持：

1. **质量档不是编的。** 每篇的 tier 由正文的客观信号算出来（段落密度、标题数、句长、
   非正文噪声比例），而不是我看一眼贴个标签；MANIFEST 里同时留下这些信号本身，
   所以「为什么这篇算 low」可以被人重新检查。另有 8 篇是按固定规则从真实文档改造出来的
   「脏文档」（表格碎片 / 只留前 300 字 / 注入 OCR 混淆 / 只剩样板壳），
   `synthetic=true` 明确标出，用来测检索在烂文档上的表现，不冒充真实来源。
2. **失败要留在账上。** 抓不到就记进 MANIFEST 并继续，绝不静默少几篇凑数；
   数量没到 100 会打印实际数字并返回非零。
3. **可重跑。** 已存在且非空的文件跳过（`--force` 才重抓），所以你后续手动补测不用重新下载。

用法（这台机器的 venv 里有 bs4 + lxml + httpx）：
    apps/backend/.venv/bin/python rag-bench/build_corpus.py
    apps/backend/.venv/bin/python rag-bench/build_corpus.py --force
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus"

UA = {"User-Agent": "Ametrine-RAG-benchmark/1.0 (local retrieval benchmark; not production scraping)"}
PER_HOST_DELAY = 0.6          # 同一来源之间歇一下，别把公开站点打出限流
TIMEOUT = 30.0

# ─────────────────────────────────────────────────────────────────────────
# 来源清单。每一项都是这台机器实测可达的域名（探测记录见 build.log 的开头）。
# 维基百科整条线（wikipedia / wikisource / wikimedia REST / ctext）在本机全部不可达，
# 所以中文语料走 MDN、Python、Kubernetes、WHO 的官方中文版，而不是硬编一个取不到的地址。
# ─────────────────────────────────────────────────────────────────────────

ARXIV_CATEGORIES = [
    ("cs.IR", "research", "信息检索"),
    ("cs.CL", "research", "自然语言处理"),
    ("cond-mat.mtrl-sci", "research", "材料物理"),
    ("q-bio.NC", "research", "神经科学"),
    ("econ.EM", "research", "计量经济"),
    ("math.HO", "research", "数学史与综述"),
    ("physics.ao-ph", "research", "大气物理"),
    ("stat.ME", "research", "统计方法"),
]

PLAIN_TEXT = [
    # (id, domain, 标题, url)  —— RFC 是纯文本，天然是「结构化长文」的高质量样本
    ("rfc9110", "protocol", "HTTP Semantics (RFC 9110)", "https://www.rfc-editor.org/rfc/rfc9110.txt"),
    ("rfc9112", "protocol", "HTTP/1.1 (RFC 9112)", "https://www.rfc-editor.org/rfc/rfc9112.txt"),
    ("rfc8446", "protocol", "TLS 1.3 (RFC 8446)", "https://www.rfc-editor.org/rfc/rfc8446.txt"),
    ("rfc6749", "protocol", "OAuth 2.0 (RFC 6749)", "https://www.rfc-editor.org/rfc/rfc6749.txt"),
    ("rfc854", "protocol", "Telnet Protocol (RFC 854)", "https://www.rfc-editor.org/rfc/rfc854.txt"),
    ("rfc1149", "protocol", "IP over Avian Carriers (RFC 1149)", "https://www.rfc-editor.org/rfc/rfc1149.txt"),
    ("rfc3514", "protocol", "Security Flag in IPv6 (RFC 3514)", "https://www.rfc-editor.org/rfc/rfc3514.txt"),
]

HTML_DOCS = [
    # (id, domain, url)  —— 语言由页面 lang 属性判，不猜
    # 中文技术文档
    ("mdn-http-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/HTTP"),
    ("mdn-cors-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/CORS"),
    ("mdn-csp-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/CSP"),
    ("mdn-cache-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Caching"),
    ("mdn-css-layout-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Learn/CSS/CSS_layout"),
    ("mdn-a11y-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Learn/Accessibility/HTML"),
    ("mdn-js-memory-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Memory_management"),
    ("mdn-webapi-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/API"),
    ("py-csv-zh", "programming", "https://docs.python.org/zh-cn/3/library/csv.html"),
    ("py-sqlite-zh", "programming", "https://docs.python.org/zh-cn/3/library/sqlite3.html"),
    ("py-concurrent-zh", "programming", "https://docs.python.org/zh-cn/3/library/concurrent.futures.html"),
    ("py-typing-zh", "programming", "https://docs.python.org/zh-cn/3/library/typing.html"),
    ("py-logging-zh", "programming", "https://docs.python.org/zh-cn/3/howto/logging.html"),
    ("k8s-svc-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/concepts/services-networking/service/"),
    ("k8s-overview-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/concepts/overview/"),
    ("k8s-hpa-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/"),
    ("k8s-pv-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/concepts/storage/persistent-volumes/"),
    ("k8s-rbac-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/reference/access-authn-authz/rbac/"),
    ("k8s-cni-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/concepts/overview/components/"),
    ("k8s-config-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/concepts/configuration/configmap/"),
    ("k8s-liveness-zh", "cloud-native", "https://kubernetes.io/zh-cn/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/"),
    ("k8s-sched-en", "cloud-native", "https://kubernetes.io/docs/concepts/scheduling-eviction/"),
    ("k8s-netpol-en", "cloud-native", "https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/"),
    ("mdn-ws-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/API/WebSockets_API"),
    ("mdn-promise-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise"),
    ("mdn-cookies-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Cookies"),
    ("mdn-perm-zh", "web-docs", "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Authentication"),
    ("who-cancer-zh", "public-health", "https://www.who.int/zh/news-room/fact-sheets/detail/cancer"),
    ("who-nutrition-zh", "public-health", "https://www.who.int/zh/news-room/fact-sheets/detail/healthy-diet"),
    ("go-effective", "programming", "https://go.dev/doc/effective_go"),
    ("iana-protos", "protocol", "https://www.iana.org/assignments/protocol-numbers/protocol-numbers.xhtml"),
    ("iana-ports", "protocol", "https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml"),
    ("pg-insert", "databases", "https://www.postgresql.org/docs/current/sql-insert.html"),
    ("pg-tutorial", "databases", "https://www.postgresql.org/docs/current/tutorial-start.html"),
    ("pg-transactions", "databases", "https://www.postgresql.org/docs/current/transaction-iso.html"),
    ("pg-indexes", "databases", "https://www.postgresql.org/docs/current/indexes.html"),
    ("pg-planner", "databases", "https://www.postgresql.org/docs/current/using-explain.html"),
    ("pg-mvcc", "databases", "https://www.postgresql.org/docs/current/mvcc.html"),
    ("pg-backup", "databases", "https://www.postgresql.org/docs/current/backup-dump.html"),
    ("pg-fulltext", "databases", "https://www.postgresql.org/docs/current/textsearch.html"),
    ("who-tb-zh", "public-health", "https://www.who.int/zh/news-room/fact-sheets/detail/tuberculosis"),
    ("who-malaria-zh", "public-health", "https://www.who.int/zh/news-room/fact-sheets/detail/malaria"),
    ("who-diabetes-zh", "public-health", "https://www.who.int/zh/news-room/fact-sheets/detail/diabetes"),
    ("who-depression-zh", "public-health", "https://www.who.int/zh/news-room/fact-sheets/detail/depression"),
    ("who-hivaids-zh", "public-health", "https://www.who.int/zh/news-room/fact-sheets/detail/hiv-aids"),
    # 英文文档与技术标准
    ("py-gil-en", "programming", "https://docs.python.org/3/library/threading.html"),
    ("py-isort-en", "programming", "https://docs.python.org/3/reference/lexical_analysis.html"),
    ("k8s-drain-en", "cloud-native", "https://kubernetes.io/docs/concepts/overview/"),
    ("w3c-wcag-en", "web-standards", "https://www.w3.org/WAI/WCAG22/quickref/"),
    ("w3c-aria-apg-en", "web-standards", "https://www.w3.org/WAI/ARIA/apg/patterns/"),
    ("w3c-aria-en", "web-standards", "https://www.w3.org/TR/wai-aria-1.1/"),
    ("w3c-html-en", "web-standards", "https://www.w3.org/TR/html52/"),
    ("nist-63b-en", "security", "https://pages.nist.gov/800-63-3/sp800-63b.html"),
    ("nist-63a-en", "security", "https://pages.nist.gov/800-63-3/sp800-63a.html"),
    ("nist-63c-en", "security", "https://pages.nist.gov/800-63-3/sp800-63c.html"),
    ("owasp-top10-en", "security", "https://owasp.org/Top10/"),
    ("owasp-a01-en", "security", "https://owasp.org/Top10/A01_2021-Broken_Access_Control/"),
    ("owasp-a02-en", "security", "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/"),
    ("mdn-fetch-en", "web-docs", "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"),
    ("mdn-serviceworker-en", "web-docs", "https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API"),
    # 文学（公有领域，长短与文体差异天然很大）——用 /files/<id>/<id>-0.txt 的纯文本形状，
    # cache/epub 的 HTML 路径在多台机器上都是 404，不能拿它当基准来源。
    ("gutenberg-frankenstein", "literature", "https://www.gutenberg.org/files/84/84-0.txt"),
    ("gutenberg-pride", "literature", "https://www.gutenberg.org/files/1342/1342-0.txt"),
    ("gutenberg-mobydick", "literature", "https://www.gutenberg.org/files/2701/2701-0.txt"),
    ("gutenberg-holmes", "literature", "https://www.gutenberg.org/files/1661/1661-0.txt"),
    ("gutenberg-tomsoyer", "literature", "https://www.gutenberg.org/files/76/76-0.txt"),
    ("gutenberg-tale2cities", "literature", "https://www.gutenberg.org/files/98/98-0.txt"),
    ("gutenberg-warpeace", "literature", "https://www.gutenberg.org/files/2600/2600-0.txt"),
    ("gutenberg-grimms", "literature", "https://www.gutenberg.org/files/2542/2542-0.txt"),
    # 生物医学（开放获取全文）
    ("pmc-obesity", "biomed", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10000000/"),
    ("pmc-gutmicro", "biomed", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10012345/"),
    ("pmc-als", "biomed", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10000601/"),
    ("pmc-lifestyle", "biomed", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10001341/"),
    ("pmc-breastca", "biomed", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10002100/"),
    ("pmc-telemed", "biomed", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10002553/"),
]

# 造脏文档的规则：都作用在**已成功抓到的真实文档**上，规则确定可复现。
NOISE_RULES = ["table-only", "truncated-300", "ocr-confusion", "boilerplate-shell"]

CJK = re.compile(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]")


def log(lines: list[str], msg: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    line = f"[{stamp}] {msg}"
    lines.append(line)
    print(line, flush=True)


def detect_lang(text: str) -> str:
    sample = text[:4000]
    cjk = len(CJK.findall(sample))
    letters = len(re.findall(r"[A-Za-z]", sample))
    if cjk and cjk * 3 > letters:
        return "zh"
    return "en" if letters else "unknown"


# ────────────────────────── 正文提取 ──────────────────────────
# 刻意不引第三方正文抽取库：那些库为「新闻页」调优，会把这些文档站点的表格与代码块
# 当成噪声丢掉，而表格和代码恰恰是技术问答里最该被检索到的内容。
DROP_TAGS = ("script", "style", "noscript", "svg", "form", "button", "iframe", "canvas",
             "nav", "footer", "aside", "header")
DROP_CLASSES = re.compile(
    r"(side|toc|nav|menu|breadcrumb|cookie|banner|footer|edit-on-github|feedback|"
    r"pagination|skip|search|language|promo|newsletter|toolbar|tabs)", re.I)


def _clean_container(soup: BeautifulSoup) -> Tag:
    for sel in ("article", "main", "[role=main]", "#main-content", ".main-content",
                ".document", "#content", ".bd-content", ".text", "body"):
        found = soup.select_one(sel)
        if found and len(found.get_text(strip=True)) > 400:
            return found
    return soup.body or soup


def _emit(node: Any, out: list[str]) -> None:
    if isinstance(node, NavigableString):
        txt = str(node)
        if txt.strip():
            out.append(re.sub(r"\s+", " ", txt))
        return
    if not isinstance(node, Tag):
        return
    if node.name in ("script", "style", "noscript", "svg", "template"):
        return
    if node.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
        if text:
            out.append(f"\n{'#' * int(node.name[1])} {text}\n")
        return
    if node.name == "pre":
        code = node.get_text("\n")
        if code.strip():
            out.append(f"\n```\n{code.strip()}\n```\n")
        return
    if node.name in ("table",):
        rows = node.select("tr")
        lines_md: list[str] = []
        for i, tr in enumerate(rows[:60]):
            cells = [re.sub(r"\s+", " ", c.get_text(" ", strip=True))[:120]
                     for c in tr.select("th,td")]
            if not cells or not any(cells):
                continue
            lines_md.append("| " + " | ".join(cells) + " |")
            if i == 0:
                lines_md.append("|" + "---|" * len(cells))
        if lines_md:
            out.append("\n" + "\n".join(lines_md) + "\n")
        return
    if node.name in ("ul", "ol"):
        for li in node.find_all("li", recursive=False):
            text = re.sub(r"\s+", " ", li.get_text(" ", strip=True))
            if text:
                out.append(f"- {text[:600]}")
        return
    if node.name == "dt":
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
        if text:
            out.append(f"\n**{text}**\n")
        return
    if node.name == "dd":
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
        if text:
            out.append(text[:1200])
        return
    if node.name in ("p", "blockquote", "section", "div", "dl", "figure", "figcaption",
                     "article", "main", "td", "th", "li", "tr"):
        # 只在下层没有块级元素时才把自身的文本当段落输出，否则交给递归（避免整页重复一遍）
        if node.find(["p", "h1", "h2", "h3", "table", "ul", "ol", "pre", "div"]):
            for child in node.children:
                _emit(child, out)
            return
        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True))
        if text:
            out.append(text)
        return
    for child in node.children:
        _emit(child, out)


def extract_html(html: str, url: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "lxml")
    container = _clean_container(soup)
    for node in list(container.select("nav, aside, footer, header")):
        node.decompose()
    for node in list(container.find_all(class_=DROP_CLASSES)):
        try:
            if node.parent is not None and node.name not in ("p", "li", "td"):
                node.decompose()
        except Exception:  # noqa: BLE001 已经脱离树的节点
            pass
    title = ""
    if soup.select_one("h1"):
        title = re.sub(r"\s+", " ", soup.select_one("h1").get_text(" ", strip=True))
    elif soup.title and soup.title.string:
        title = soup.title.string.strip()
    parts: list[str] = []
    _emit(container, parts)
    body = "\n\n".join(dict.fromkeys(p for p in parts if p.strip()))  # 顺序去重，压掉重复导航
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    if not title:
        title = url.rsplit("/", 1)[-1] or url
    return title, body


def extract_text(raw: str, url: str) -> tuple[str, str]:
    """RFC / Gutenberg 这类纯文本：只压空白，不动内容。"""
    text = raw.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text).strip()
    head = text[:400]
    title = ""
    m = re.search(r"^(Title|Title:)\s*(.+)$", head, re.M)
    if m:
        title = m.group(2).strip()
    if not title:
        for line in head.splitlines():
            if len(line.strip()) > 12 and not line.startswith((" ", "#")):
                title = line.strip()
                break
    return (title or url.rsplit("/", 1)[-1]), text


# ────────────────────────── 质量档：从客观信号算 ──────────────────────────

def signals(text: str) -> dict[str, float]:
    paras = [p for p in text.split("\n\n") if p.strip()]
    sentences = re.findall(r"[^.!?\n]{15,}[.!?]|[\u4e00-\u9fff]{10,}[。！？]", text)
    chars = len(text)
    headings = len(re.findall(r"^#{1,6} ", text, re.M))
    code = len(re.findall(r"```", text))
    table_rows = len(re.findall(r"^\|", text, re.M))
    # 噪声：不可打印/替换符、连续非常规符号、单字符碎行的比例
    junk = len(re.findall(r"[\ufffd\u0000-\u0008\u0010-\u001f]", text))
    weird = len(re.findall(r"[^\w\s\u4e00-\u9fff。，、；：？！“”‘’（）《》\-/\\:;,.!?()<>\[\]{}#*`'\"|=+_%&@$~^ 　\n\t]", text))
    short_lines = sum(1 for p in text.splitlines() if 0 < len(p.strip()) < 4)
    nonempty_lines = max(1, len([p for p in text.splitlines() if p.strip()]))
    return {
        "chars": chars,
        "paragraphs": len(paras),
        "sentences": len(sentences),
        "avg_sentence_chars": round(chars / max(1, len(sentences)), 1),
        "headings": headings,
        "code_blocks": code // 2,
        "table_rows": table_rows,
        "junk_chars": junk,
        "symbol_ratio": round((junk + weird) / max(1, chars), 4),
        "broken_line_ratio": round(short_lines / nonempty_lines, 4),
    }


def tier_for(sig: dict[str, float]) -> str:
    """high=成段长文且有结构；low=很短或噪声高；mid=其余。规则写在明处，可被复核。"""
    if sig["chars"] < 1200 or sig["symbol_ratio"] > 0.035 or sig["broken_line_ratio"] > 0.45:
        return "low"
    prose = sig["sentences"] >= 12 and sig["avg_sentence_chars"] >= 25
    structured = sig["headings"] >= 3 or sig["table_rows"] >= 5 or sig["code_blocks"] >= 2
    if prose and structured and sig["chars"] >= 6000:
        return "high"
    if prose or structured:
        return "mid"
    return "low"


# ────────────────────────── 抓取 ──────────────────────────

def fetch(client: httpx.Client, url: str, attempts: int = 3) -> tuple[str | None, str, int]:
    """返回 (正文或None, 错误原因, http状态)。失败不抛异常，交给上层记账。

    重试只针对**传输层**的抖动（这台机器实测到 NIST/OWASP 会 TLS 握手超时，
    同一个地址过几秒又正常）。HTTP 4xx 不重试：那是地址本身错了，重试只是浪费时间，
    而且会把「我 URL 写错了」洗成「这个来源不稳定」。
    """
    last = ""
    code = 0
    for i in range(attempts):
        try:
            r = client.get(url, follow_redirects=True)
        except Exception as exc:  # noqa: BLE001
            last = f"{type(exc).__name__}: {str(exc)[:120]}"
            code = 0
            if i + 1 < attempts:
                time.sleep(2 + 3 * i)
                continue
            return None, last, code
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}", r.status_code
        if r.text.strip():
            return r.text, "", r.status_code
        return None, f"空响应体（{r.headers.get('content-type','?')}）", r.status_code
    return None, last, code


def save_doc(entry: dict[str, Any], title: str, body: str, force: bool) -> dict[str, Any]:
    path = CORPUS / entry["domain"] / f"{entry['id']}.md"
    sig = signals(body)
    lang = detect_lang(body)
    front = "\n".join([
        f"# {title}",
        "",
        f"来源: {entry['url']}",
        f"领域: {entry['domain']} | 语言: {lang} | 抓取: {time.strftime('%Y-%m-%d')}",
        "",
        "---",
        "",
    ])
    content = (front + body).strip() + "\n"
    existed = path.exists() and path.stat().st_size > 0
    if existed and not force:
        action = "skip"
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        action = "new" if not existed else "rewrite"
    entry.update({
        "path": str(path.relative_to(ROOT)),
        "title": title,
        "lang": lang,
        "tier": tier_for(sig),
        "signals": sig,
        "sha1": hashlib.sha1(content.encode()).hexdigest()[:12],
        "fetch": action,
    })
    return entry


def arxiv_plan(client: httpx.Client, notes: list[str]) -> list[dict[str, str]]:
    """用 arXiv 的官方 API 枚举每个分类的真实论文 id。

    不硬编 id：硬编的那串号明年就会 404，那 404 看起来完全像「我的抓取脚本坏了」。
    """
    out: list[dict[str, str]] = []
    for cat, domain, zh in ARXIV_CATEGORIES:
        url = (f"http://export.arxiv.org/api/query?search_query=cat:{cat}"
               f"&start=0&max_results=3&sortBy=submittedDate&sortOrder=descending")
        raw, err, _ = fetch(client, url)
        if not raw:
            log(notes, f"  arXiv 分类枚举失败 {cat}: {err}")
            continue
        soup = BeautifulSoup(raw, "xml")
        for i, e in enumerate(soup.find_all("entry")[:3]):
            aid = (e.find("id").text or "").rsplit("/", 1)[-1]
            out.append({"id": f"arxiv-{aid.replace('/', '-').replace('.', '-').lower()}",
                        "domain": domain, "url": f"https://arxiv.org/html/{aid}v1",
                        "fallback": f"https://arxiv.org/abs/{aid}", "cat_zh": zh})
        time.sleep(PER_HOST_DELAY)
    return out


def make_noisy(base: dict[str, Any], text: str, rule: str) -> str:
    if rule == "table-only":
        rows = [l for l in text.splitlines() if l.strip().startswith("|")]
        return "\n".join(rows[:80]) or text[:400]
    if rule == "truncated-300":
        return text[:300]
    if rule == "ocr-confusion":
        table = str.maketrans({"l": "I", "I": "l", "o": "0", "a": "@", "S": "5", "e": "£"})
        frag = text[:6000]
        return "".join(c if i % 7 else c.translate(table) for i, c in enumerate(frag))
    if rule == "boilerplate-shell":
        return ("Cookies Policy | Terms of Use | Contact us | Subscribe\n" * 6
                + "\nThis page requires JavaScript.\n" + text[:200])
    return text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="已存在的文件也重新抓取覆盖")
    ap.add_argument("--limit", type=int, default=0, help="只抓前 N 篇（调脚本用）")
    args = ap.parse_args()

    CORPUS.mkdir(parents=True, exist_ok=True)
    notes: list[str] = []
    log(notes, "开始构建 RAG 基准语料")

    plan: list[dict[str, str]] = []
    plan += [{"id": i, "domain": d, "url": u} for i, d, u in
             ((x[0], x[1], x[3]) for x in PLAIN_TEXT)]
    plan += [{"id": i, "domain": d, "url": u} for i, d, u in HTML_DOCS]
    with httpx.Client(headers=UA, timeout=TIMEOUT) as client:
        plan += arxiv_plan(client, notes)
        for p in plan:
            p.setdefault("kind", "txt" if p["url"].endswith((".txt",)) else "html")

    if args.limit:
        plan = plan[:args.limit]

    entries: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    last_host: dict[str, float] = {}

    with httpx.Client(headers=UA, timeout=TIMEOUT) as http:
        for spec in plan:
            host = httpx.URL(spec["url"]).host
            wait = PER_HOST_DELAY - (time.time() - last_host.get(host, 0))
            if wait > 0:
                time.sleep(wait)
            last_host[host] = time.time()

            entry = {"id": spec["id"], "domain": spec["domain"], "url": spec["url"],
                     "synthetic": False}
            raw, err, code = fetch(http, spec["url"])
            used_url = spec["url"]
            if raw is None and spec.get("fallback"):
                raw, err2, code = fetch(http, spec["fallback"])
                used_url, err = spec["fallback"], err2
                entry["fallback_used"] = True
            if raw is None:
                entry.update({"fetch": "failed", "error": err or f"HTTP {code}"})
                failures.append(entry)
                log(notes, f"  ✗ {spec['id']}  {entry['error']}")
                continue

            try:
                if used_url.endswith(".txt"):
                    title, body = extract_text(raw, used_url)
                else:
                    title, body = extract_html(raw, used_url)
            except Exception as exc:  # noqa: BLE001
                entry.update({"fetch": "extract-error",
                              "error": f"{type(exc).__name__}: {exc}"})
                failures.append(entry)
                log(notes, f"  ✗ {spec['id']} 提取失败 {entry['error']}")
                continue
            if len(body.strip()) < 120:
                entry.update({"fetch": "too-thin",
                              "error": f"正文仅 {len(body.strip())} 字"})
                failures.append(entry)
                log(notes, f"  ✗ {spec['id']} 正文过薄（多半是 JS 渲染页）")
                continue

            entry["url"] = used_url
            save_doc(entry, title, body, args.force)
            entries.append(entry)
            log(notes, f"  ✓ {entry['domain']}/{entry['id']} [{entry['tier']}/{entry['lang']}] "
                       f"{entry['signals']['chars']}字")

    # 脏文档：从已成功的高/中档文档里按规则改造，明确标 synthetic
    pool = [e for e in entries if e["tier"] in ("high", "mid")]
    for k, rule in enumerate(NOISE_RULES):
        for src in pool[k::4][:2]:
            path = ROOT / src["path"]
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")
            body = make_noisy(src, text, rule)
            entry = {"id": f"noise-{rule}-{src['id'][:18]}", "domain": "noisy",
                     "url": f"derived:{src['url']}", "synthetic": True, "rule": rule,
                     "derived_from": src["id"]}
            save_doc(entry, f"[改造样本·{rule}] {entry['derived_from']}", body, args.force)
            entries.append(entry)
            log(notes, f"  ◇ 脏文档 {entry['id']} [{entry['tier']}] "
                       f"{entry['signals']['chars']}字（规则 {rule}）")

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "count": len(entries),
        "failed": len(failures),
        "by_domain": {},
        "by_tier": {},
        "by_lang": {},
        "documents": entries,
        "failures": failures,
    }
    for e in entries:
        manifest["by_domain"][e["domain"]] = manifest["by_domain"].get(e["domain"], 0) + 1
        manifest["by_tier"][e["tier"]] = manifest["by_tier"].get(e["tier"], 0) + 1
        manifest["by_lang"][e["lang"]] = manifest["by_lang"].get(e["lang"], 0) + 1

    (ROOT / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# RAG 基准语料清单", "",
             f"生成时间：{manifest['generated_at']} 成功 {manifest['count']} 篇，"
             f"失败 {manifest['failed']} 篇。", "",
             "## 分布", "", "| 维度 | 值 | 篇数 |", "|---|---|---|"]
    for name, key in (("领域", "by_domain"), ("质量档", "by_tier"), ("语言", "by_lang")):
        for k, v in sorted(manifest[key].items()):
            lines.append(f"| {name} | {k} | {v} |")
    lines += ["", "## 全部文档", "", "| 文件 | 领域 | 档 | 语言 | 字数 | 标题 | 来源 |",
              "|---|---|---|---|---|---|---|"]
    for e in entries:
        lines.append(f"| {e['path']} | {e['domain']} | {e['tier']} | {e['lang']} | "
                     f"{e['signals']['chars']} | {e['title'][:40]} | {e['url'][:70]} |")
    if failures:
        lines += ["", "## 抓取失败（不是静默跳过）", "", "| id | 原因 | 地址 |", "|---|---|---|"]
        for f in failures:
            lines.append(f"| {f['id']} | {f['error']} | {f['url']} |")
    (ROOT / "MANIFEST.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "build.log").write_text("\n".join(notes) + "\n", encoding="utf-8")

    sizes = [e["signals"]["chars"] for e in entries]
    log(notes, f"完成：{len(entries)} 篇；字数中位 "
               f"{int(statistics.median(sizes)) if sizes else 0}；失败 {len(failures)}")
    print(f"\nCORPUS_COUNT={len(entries)} FAILED={len(failures)}")
    if len(entries) < 100:
        print("注意：不足 100 篇。上面 MANIFEST 的 failures 段列了每一个原因。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
