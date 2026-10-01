#!/usr/bin/env python
"""格式基准第 0 步：找**真实存在、出版方托管**的文件，并把候选落到磁盘上。

为什么先做这一步而不是直接写下载脚本：上一轮吃过教训 —— 凭记忆写 URL 会撞一串 404
（Gutenberg/k8s/W3C 都错过），而「404 之后再来改脚本」比「先探测再写死」慢得多。
所以这里只做探测，不下载正文，产出 `formats-candidates.json` 给 build_formats_corpus.py 用。

两类来源，都必须可核验：
  1) 直链（arXiv/RFC/NIST/Gutenberg/World Bank/GeoNames/OWID）：格式确定、URL 稳定。
  2) **数据目录 API**（加拿大开放数据 CKAN、欧盟数据门户）：它给出的是出版方自己托管的
     .docx/.xlsx/.odt/.pptx 附件。Office 格式没有「好猜的稳定直链」，
     靠 API 列出来的才是真实存在的那份，而不是我拼出来的。

用法：
    apps/backend/.venv/bin/python rag-bench/probe_formats.py
"""

from __future__ import annotations

import json
import re
import sys
import threading
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (X11; Linux x86_64) Ametrine-rag-bench/1 (document format research)"

# 直链候选：每条都是「这个格式在这个来源上确定有货」的写法。
DIRECT = {
    ".pdf": [
        "https://export.arxiv.org/pdf/1706.03762",
        "https://www.rfc-editor.org/rfc/rfc9110.pdf",
        "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63b.pdf",
    ],
    ".html": [
        "https://www.rfc-editor.org/rfc/rfc9112.html",
        "https://www.postgresql.org/docs/current/sql-select.html",
        "https://www.w3.org/TR/webauthn-2/",
    ],
    ".txt": [
        "https://www.gutenberg.org/cache/epub/84/pg84.txt",
        "https://download.geonames.org/export/dump/countryInfo.txt",
    ],
    ".csv": [
        # 出版方自己的 CSV 出口。上一版里 OWID 与 raw.githubusercontent.com 两条
        # 在本机代理下都是 `SSL: UNEXPECTED_EOF_WHILE_READING`（不是 404，是代理断流），
        # 留着只会让报告里的「候选数」变少，所以换成 NOAA / 世界银行 / ECB 的开放数据出口。
        "https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=USW00094728&dataTypes=TAVG&startDate=2024-01-01&endDate=2024-02-29&format=csv",
        "https://api.worldbank.org/v2/country/CAN%3BUSA/indicator/SP.POP.TOTL?format=csv&download=true",
        "https://data-api.ecb.europa.eu/service/data/1.0.0.W.X.EA.E.U20.PCN.C.IXW.PT.XD.EUR?startPeriod=2015&endPeriod=2024&format=csvdata",
    ],
    ".epub": [
        "https://www.gutenberg.org/cache/epub/2701/pg2701.epub",
        "https://www.gutenberg.org/ebooks/1342.epub.noimages",
        "https://www.gutenberg.org/ebooks/84.epub.noimages",
    ],
    # .eml 不在这里：公共源上没有「单封邮件」的直链，改由 build_formats_corpus.py
    # 从 Apache SpamAssassin 公开邮件语料（出版方自己的 tar.bz2）里按分隔符拆出真实邮件。
}

# 数据目录 API：按格式取「出版方托管的 office 文件」。
# 多个门户 × 每门户多取几条（rows=20），而不是单一查询要 4 条：office 附件常常挂在
# 「只有介绍页」的包上，样本一小就一个文件都捞不到（实测 .pptx 就是这样空手而归）。
CKAN_PORTALS = [
    "https://open.canada.ca/data/api/3/action/package_search",
    "https://data.nsw.gov.au/data/api/3/action/package_search",
]
FORMAT_ALIASES = {
    ".xlsx": ["XLSX", "Excel"],
    ".docx": ["DOCX", "Word"],
    ".odt": ["ODT", "OpenDocument"],
    ".pptx": ["PPTX", "PowerPoint"],
    ".doc": ["DOC", "MS Word"],
    ".ppt": ["PPT", "MS Powerpoint"],
    ".csv": ["CSV"],
    ".txt": ["TXT", "Text"],
    ".pdf": ["PDF"],
}


def api_queries(fmt: str) -> list[str]:
    """CKAN 的 res_format 里带空格的值（`MS Word`）必须是短语查询，裸 token 查不到。"""
    out: list[str] = []
    for portal in CKAN_PORTALS:
        for alias in FORMAT_ALIASES.get(fmt, []):
            out.append(f'{portal}?q=*:*&rows=20&fq=res_format:%22{quote(alias)}%22')
    return out


def _with_cap(fn, seconds: int, url: str):
    """给单次网络往返一个**总**上限。

    `urlopen(timeout=…)` 只管 socket 上的单次操作：本机代理接受 CONNECT 之后不把隧道
    打通时，请求会一直停在 poll 里（实测这一轮就是这么卡住 15 分钟，一个字都没吐出来），
    看起来像脚本坏了，其实是某个源在代理后面僵死。

    用 daemon 线程而不是 ThreadPoolExecutor：线程池的 `with` 退出会 `shutdown(wait=True)`，
    于是又回到「等那个僵死请求」——正是要防那件事。
    """
    box: dict = {}
    done = threading.Event()

    def run():
        try:
            box["value"] = fn(url)
        except Exception as e:  # noqa: BLE001
            box["error"] = e
        finally:
            done.set()

    threading.Thread(target=run, daemon=True).start()
    if not done.wait(seconds):
        return {"url": url, "status": None, "error": f"超过 {seconds}s 总上限，放弃这个源"}
    if "error" in box:
        e = box["error"]
        return {"url": url, "status": getattr(e, "code", None), "error": f"{type(e).__name__}: {e}"}
    return box["value"]


def head(url: str, cap: int = 262144):
    """GET + Range 只取头部字节：既要状态码也要 content-type 与实际魔数。

    不用 HEAD 是因为不少出版方（含加拿大开放数据的重定向链）对 HEAD 回 403/405，
    那会把真实存在的文件误判成不存在。
    """
    if not url.lower().startswith(("http://", "https://")):
        return {"url": url, "status": None, "error": "不是绝对 URL（目录 API 给的相对链接）"}
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Range": f"bytes=0-{cap - 1}", "Accept": "*/*"})

    def go(u: str):
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(65536)
            return {
                "url": u,
                "status": r.status,
                "type": (r.headers.get("Content-Type") or "").split(";")[0],
                "length": r.headers.get("Content-Length"),
                "magic": body[:8].hex(),
                "head_text": body[:240].decode("utf-8", "replace").replace("\n", " ") if body else "",
            }

    try:
        return _with_cap(go, 30, url)
    except Exception as e:  # noqa: BLE001
        return {"url": url, "status": getattr(e, "code", None),
                "error": f"{type(e).__name__}: {e}"}


def looks_like_a_document(fmt: str, rec: dict) -> tuple[bool, str]:
    """按容器魔数判「这真的是一份 <fmt>」，而不是一个 HTML 错误页或重定向壳。

    这一步不能省：目录 API 会把「资源详情页」当成资源文件列出来（实测 403/404/HTML 三种），
    不校验就会把 HTML 存成 .odt 入库，然后测出一个谁也不信的结论。
    """
    magic = (rec.get("magic") or "")
    text = (rec.get("head_text") or "").lstrip().lower()
    zip_ok = magic.startswith("504b0304")
    ole_ok = magic.startswith("d0cf11e0")
    if fmt == ".pdf":
        ok = magic.startswith("25504446")
    elif fmt in (".doc", ".ppt"):
        ok = ole_ok
    elif fmt in (".docx", ".xlsx", ".pptx", ".epub", ".odt"):
        # OOXML 与 ODF/EPUB 都是 zip 容器；内容类型留到下载阶段逐条目确认。
        ok = zip_ok
    elif fmt in (".html",):
        ok = text.startswith(("<!doctype", "<html", "<head", "<title", "<?xml"))
    elif fmt == ".eml":
        ok = bool(re.match(r"^(from |to |subject |x-|received:|date |return-path)", text))
    else:  # .txt / .csv / .markdown：纯文本即可，但不能是任何标记语言
        # 只挡 `<!doctype`/`<html` 不够：世界银行那条 `?format=csv` 实际回的是 `<?xml …`，
        # 放它过去就会把一篇 XML 当 .csv 收进语料，「CSV 的检索质量」量的就不是 CSV 了。
        ok = (not text.lstrip().startswith("<")) and bool(text)
    return ok, ("" if ok else f"魔数/首部不像 {fmt}：magic={magic[:12]} type={rec.get('type')}")


def absolute(api: str, url: str) -> str:
    """目录 API 会把相对路径当资源 URL 列出来（实测加拿大门户就是这样），
    而空格也没转义（`television logs/….doc`）。不修的话 urllib 直接 ValueError，
    看起来像「这个格式没有真实文件」，其实是我的读法不对。"""
    from urllib.parse import quote, urlsplit
    u = url.strip()
    if u.startswith("//"):
        u = urlsplit(api).scheme + ":" + u
    elif u.startswith("/"):
        p = urlsplit(api)
        u = f"{p.scheme}://{p.netloc}" + u
    elif not u.startswith(("http://", "https://")):
        return ""
    s = urlsplit(u)
    return s._replace(path=quote(s.path, safe="/%-")).geturl()


def from_ckan(url: str, fmt: str) -> list[dict]:
    """CKAN package_search → 该格式的**文件**资源，带出处（包标题 + 出版机构）。

    出处必须一起取：报告里要说得出「这份 xlsx 是谁发布的」，
    只有一串 URL 的话用户没法判断它是不是真文档。
    """
    out: list[dict] = []

    def go(u: str):
        with urllib.request.urlopen(urllib.request.Request(
                u, headers={"User-Agent": UA}), timeout=20) as r:
            return {"json": json.loads(r.read())}

    got = _with_cap(go, 35, url)
    if "json" not in got:
        print(f"  ✗ {fmt} 目录 API 失败: {got.get('error')}")
        return out
    data = got["json"]
    for pkg in (data.get("result") or {}).get("results", []):
        org = ((pkg.get("organization") or {}).get("title")
               or pkg.get("owner_org") or pkg.get("publisher") or "")
        for res in pkg.get("resources", []):
            u = absolute(url, (res.get("url") or "").strip())
            # 只要「以该扩展名结尾」的那条链接；目录里很多资源给的是详情页 URL，
            # 它们在下一层被魔数校验挡掉，不在这里猜。
            if u and u.lower().split("?")[0].endswith(fmt):
                out.append({"url": u, "package": pkg.get("title") or "",
                            "organization": org, "api": url})
        if len(out) >= 4:
            break
    return out


def discover() -> dict[str, list[dict]]:
    """返回每个格式的**已验证容器**候选（不落盘正文，只取头部字节）。

    直链给的是「确定有货」的那几个源；目录 API 给的是 office 格式与 CSV/TXT 的补充。
    两路都必须过 `looks_like_a_document`，所以「候选数」的含义是**容器为真的文件数**，不是链接数。
    """
    found: dict[str, list[dict]] = {}
    for fmt, urls in DIRECT.items():
        print(f"== 直链 {fmt}")
        rows = []
        for u in urls:
            rec = head(u)
            ok, why = looks_like_a_document(fmt, rec)
            print(f"  {'✓' if ok else '✗'} {rec.get('status')} {rec.get('type') or ''} "
                  f"{(rec.get('error') or why)[:44]} {u[:64]}")
            if ok:
                rec["provenance"] = {"container": "publisher-native", "package": "",
                                     "organization": urlparse(u).netloc}
                rows.append(rec)
        found[fmt] = rows
    for fmt in [f for f in FORMAT_ALIASES if f not in (".pdf", ".csv", ".txt")]:
        # 直链已经把 PDF/CSV/TXT 覆盖到了，那三种再去目录里捞一遍只会收获一堆
        # 「其实是落地页」的 HTML 响应（实测魁北克与 NSW 门户各回 200/202 text/html），
        # 白付几十次网络等待。
        print(f"== 目录 API {fmt}")
        rows, tried, checked = [], set(), 0
        for api in api_queries(fmt):
            for cand in from_ckan(api, fmt):
                if cand["url"] in tried or checked >= 10:
                    continue
                checked += 1
                tried.add(cand["url"])
                rec = head(cand["url"])
                ok, why = looks_like_a_document(fmt, rec)
                if ok:
                    rec["provenance"] = {"container": "publisher-native", **cand}
                    rows.append(rec)
                print(f"  {'✓' if ok else '✗'} {rec.get('status')} {why[:30]} {cand['url'][:56]}")
            if len(rows) >= 4:
                break
        found[fmt] = rows
    for fmt in sorted(set(DIRECT) | set(FORMAT_ALIASES)):
        found.setdefault(fmt, [])
    return found


def main() -> int:
    found = discover()
    (ROOT / "formats-candidates.json").write_text(
        json.dumps(found, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n每格式可用候选数：")
    for fmt in sorted(found):
        print(f"  {fmt:<9} {len(found[fmt])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
