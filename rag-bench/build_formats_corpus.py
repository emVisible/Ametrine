#!/usr/bin/env python
"""多格式真实语料：把应用白名单里**每一种扩展名**都拿真实的出版方文件测一遍。

存在的理由：上一轮 105 篇全部是 `.md`，也就是说 `LOADER_MAPPING` 里 14 个扩展名只走过 1 个。
「入库格式已逐类实测」那次量的是 `load_document()` 能不能解析（离线、单文件），
不是「走完整上传链路之后，内容还剩多少、还查不查得出来」—— 后者的缺口在这里。

三条口径，别在后面偷偷改掉：
1. **内容必须真实**：全部来自出版方自己托管的文件（arXiv/RFC/NIST/Gutenberg/World Bank/ECB/
   加拿大开放数据/欧盟数据门户/Apache SpamAssassin 公开邮件语料）。
   我自己产的容器一律标 `container: "locally-wrapped"` 并在报告里点名，不冒充出版方原件。
2. **容器必须逐条验魔数**（zip 还要看内部部件名）。目录 API 会把「资源详情页」当资源列出来，
   不验就会把 HTML 存成 .odt 再入库，测出一个谁也不信的结论。
3. **抓不到就明说抓不到**：某个格式一条都没有时脚本非零退出，而不是让报告看起来「覆盖了 14 种」。

用法：
    apps/backend/.venv/bin/python rag-bench/build_formats_corpus.py
产物：
    rag-bench/formats/**                       真实文件本体
    rag-bench/formats/MANIFEST.json            出处 + sha256 + 字节数 + 容器校验结论
    rag-bench/formats-coverage.md              每种格式拿到几份、缺谁、为什么
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_formats import UA, discover  # noqa: E402  复用同一份发现逻辑，不写第二份

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "formats"
MAX_BYTES = 15_000_000

# 应用白名单里的全部扩展名（`LOADER_MAPPING`），一个都不跳过。
TARGETS = [".csv", ".doc", ".docx", ".eml", ".epub", ".html", ".markdown",
           ".md", ".odt", ".pdf", ".ppt", ".pptx", ".txt", ".xlsx"]
PER_FORMAT = 4

SPAM_TARBALL = "https://spamassassin.apache.org/old/publiccorpus/20030228_easy_ham.tar.bz2"


def validate(ext: str, blob: bytes) -> tuple[bool, str]:
    """按容器实际结构判定，而不是按扩展名或 content-type 判定。"""
    if ext == ".pdf":
        ok = blob[:5] == b"%PDF-" and b"%%EOF" in blob[-4096:]
        return ok, f"pdf-header={blob[:8]!r}"
    if ext in (".docx", ".xlsx", ".pptx", ".odt", ".epub"):
        if blob[:2] != b"PK":
            return False, "不是 zip 容器"
        try:
            names = set(zipfile.ZipFile(io.BytesIO(blob)).namelist())
        except Exception as e:  # noqa: BLE001
            return False, f"zip 读不出条目：{e}"
        need = {
            ".docx": {"word/document.xml"},
            ".xlsx": {"xl/workbook.xml"},
            ".pptx": {"ppt/presentation.xml"},
            ".odt": {"content.xml", "META-INF/manifest.xml"},
            ".epub": {"META-INF/container.xml"},
        }[ext]
        missing = need - names
        if missing:
            return False, f"缺内部部件 {sorted(missing)[:3]}"
        if ext in (".odt", ".epub"):
            want = (b"opendocument.text" if ext == ".odt" else b"application/epub+zip")
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                mime = z.read("mimetype") if "mimetype" in names else b""
            if want not in mime[:128]:
                return False, f"mimetype 部件不符：{mime[:60]!r}"
        return True, f"内部部件齐全（{len(names)} 项）"
    if ext in (".doc", ".ppt"):
        return blob[:8] == bytes.fromhex("d0cf11e0a1b11ae1"), f"ole-magic={blob[:8].hex()}"
    if ext in (".html", ".md", ".markdown", ".txt", ".csv", ".eml"):
        try:
            text = blob.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = blob.decode("latin-1")
            except Exception:  # noqa: BLE001
                return False, "既不是 utf-8 也不是 latin-1"
        low = text.lstrip()[:200].lower()
        if ext == ".html":
            ok = low.startswith(("<!doctype", "<html", "<head", "<title", "<?xml")) and "<body" in text.lower()
            return ok, f"html-head={low[:24]!r}"
        if low.startswith(("<!doctype", "<html")):
            return False, "期望纯文本却拿到 HTML"
        if low.startswith("<"):
            # 只挡上面那两个不够：实测世界银行的 `?format=csv` 回的是 `<?xml` 错误页，
            # 首行里恰好有逗号就会被收下 —— 那等于把 XML 当 CSV 测。
            return False, f"期望纯文本却拿到标记语言：{low[:16]!r}"
        if ext == ".csv":
            first = next((l for l in text.splitlines() if l.strip()), "")
            return first.count(",") >= 1, f"csv 首列分隔符数={first.count(',')}"
        if ext == ".eml":
            ok = bool(re.match(r"^(from|to|subject|received|x-|date|return-path)", low)) and "\n\n" in text
            return ok, f"eml-head={low[:24]!r}"
        return len(text.split()) >= 20, f"词数={len(text.split())}"
    return False, f"未登记的要校验格式 {ext}"


def fetch(url: str, cap: int = MAX_BYTES) -> tuple[bytes | None, dict]:
    """整份下载也要有总上限：卡住的代理会把一次 urlopen 永远挂在 poll 上（实测）。"""
    import threading

    box: dict = {}

    def go():
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                box["blob"] = r.read(cap + 1)
                box["meta"] = {"status": r.status,
                               "content_type": (r.headers.get("Content-Type") or "").split(";")[0]}
        except Exception as e:  # noqa: BLE001
            box["error"] = f"{type(e).__name__}: {e}"

    t = threading.Thread(target=go, daemon=True)
    t.start()
    t.join(200)
    if t.is_alive():
        return None, {"url": url, "error": "超过 200s 总上限，放弃这个源"}
    if "blob" not in box:
        return None, {"url": url, "error": box.get("error", "没读到内容")}
    if len(box["blob"]) > cap:
        return None, {**box["meta"], "error": f"超过 {cap} 字节上限"}
    return box["blob"], box["meta"]


def slugify(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", text.lower()).strip("-._")
    return (s[:48] or "doc")


def lang_of(text: str) -> str:
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    return "zh" if cjk > max(20, len(text) // 40) else "en"


def title_of(ext: str, blob: bytes) -> str:
    """尽力取出文档自己的标题；取不到就用文件名（并在清单里如实标出来）。"""
    text = ""
    try:
        if ext == ".html":
            text = blob.decode("utf-8", "replace")
            m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
            if m:
                return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()[:120]
        elif ext in (".md", ".markdown", ".txt", ".eml"):
            text = blob.decode("utf-8", "replace")
            m = re.search(r"^#\s+(.+)$", text, re.M)
            if m:
                return m.group(1).strip()[:120]
            m = re.search(r"^Subject:\s*(.+)$", text, re.M | re.I)
            if m:
                return m.group(1).strip()[:120]
        elif ext in (".docx", ".odt"):
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                part = "word/document.xml" if ext == ".docx" else "content.xml"
                if part in z.namelist():
                    xml = z.read(part).decode("utf-8", "replace")
                    m = re.search(r"[Tt]itle[^\"]*\"?>([^<>]{6,120})<", xml)
                    if m:
                        return m.group(1).strip()
        elif ext == ".pdf":
            m = re.search(rb"/Title\s*\(([^)]{3,120})\)", blob[:200000])
            if m:
                return m.group(1).decode("latin-1").strip()
    except Exception:  # noqa: BLE001
        pass
    return ""


def real_content_bank(limit_docs: int = 8) -> list[dict]:
    """取「已经验过出处」的真实正文当填充内容，而不是我编句子。

    来源是上一轮语料（每篇都带出版方 URL 与 sha），所以这里出现的每一句话
    都能在 `MANIFEST.json` 里追溯到发布它的人。
    """
    manifest = json.loads((ROOT / "MANIFEST.json").read_text(encoding="utf-8"))
    bank: list[dict] = []
    for d in manifest["documents"]:
        p = ROOT / d["path"]
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        paras = [re.sub(r"[#*>`|]+", " ", ln).strip() for ln in text.splitlines()]
        paras = [x for x in paras if 60 < len(x) < 900 and not x.lower().startswith(("http", "www", "doi:"))]
        if len(paras) >= 8:
            bank.append({"id": d["id"], "url": d.get("url", ""), "title": d.get("title", ""),
                         "lang": d.get("lang", "en"), "paras": paras[:20]})
        if len(bank) >= limit_docs:
            break
    return bank


def wrap_office(ext: str, item: dict) -> bytes | None:
    """把真实正文装进一个 office 容器（本地生成，清单里标 locally-wrapped）。

    只在出版方原件拿不到时用来**覆盖解析路径**：它证明的是「这种容器应用能读对」，
    不证明「网上有人这么发布」—— 报告里必须把这两件事分开写。
    """
    body, title = item["paras"], (item["title"] or item["id"])[:80]
    try:
        if ext == ".docx":
            import docx
            doc = docx.Document()
            doc.add_heading(title, level=1)
            doc.add_paragraph(f"Source: {item['url']}")
            for para in body:
                doc.add_paragraph(para)
            out = io.BytesIO()
            doc.save(out)
            return out.getvalue()
        if ext == ".pptx":
            from pptx import Presentation
            from pptx.util import Inches, Pt
            prs = Presentation()
            slide = prs.slides.add_slide(prs.slide_layouts[0])
            slide.shapes.title.text = title
            for i in range(0, len(body), 6):
                s = prs.slides.add_slide(prs.slide_layouts[1])
                s.shapes.title.text = f"{item['id']} · 第 {i // 6 + 1} 页"
                tf = s.shapes.placeholders[1].text_frame
                tf.word_wrap = True
                for n, para in enumerate(body[i:i + 6]):
                    p = tf.paragraphs[0] if n == 0 else tf.add_paragraph()
                    p.text = para[:280]
                    p.font.size = Pt(12)
                s.shapes.add_textbox(Inches(0.5), Inches(6.6), Inches(8), Inches(0.4)).text_frame.text = \
                    f"Source: {item['url']}"
            out = io.BytesIO()
            prs.save(out)
            return out.getvalue()
        if ext == ".xlsx":
            from openpyxl import Workbook
            wb = Workbook()
            ws = wb.active
            ws.title = item["id"][:28]
            ws.append(["source_document", "publisher_url", "paragraph_no", "text"])
            for n, para in enumerate(body, 1):
                ws.append([item["id"], item["url"], n, para])
            out = io.BytesIO()
            wb.save(out)
            return out.getvalue()
        if ext == ".odt":
            return build_odt(title, item["url"], body)
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ 本地容器生成失败 {ext} {item['id']}: {type(e).__name__}: {e}")
    return None


def esc(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def build_odt(title: str, url: str, body: list[str]) -> bytes:
    """手搓一个合法 ODT：它是 zip，但 mimetype 条目必须**未压缩且排第一**。

    本机没有 odfpy（实测 ModuleNotFoundError）。第一版只写了 mimetype + manifest + content.xml，
    **实测被应用自己的解析器打回来**：`pypandoc … Pandoc died with exitcode "64" —
    Could not find styles.xml` ⇒ 那是一个不合格的 ODT。ODF 1.2 里 styles.xml 与 meta.xml
    都要在 manifest 里登记，pandoc 会直接去找它们。这个错正好说明「本地造的容器」
    必须按标准完整，否则测的是我的 zip 而不是解析路径。
    """
    manifest = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">'
        '<manifest:file-entry manifest:full-path="/" '
        'manifest:media-type="application/vnd.oasis.opendocument.text"/>'
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
        '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
        '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>'
        '</manifest:manifest>')
    ns = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
          'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
          'office:version="1.2"')
    paras = "".join(f"<text:p>{esc(p)}</text:p>" for p in [title, f"Source: {url}", *body])
    content = ('<?xml version="1.0" encoding="UTF-8"?>'
               f'<office:document-content {ns}>'
               f'<office:body><office:text>{paras}</office:text></office:body>'
               '</office:document-content>')
    styles = ('<?xml version="1.0" encoding="UTF-8"?>'
              '<office:document-styles '
              'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
              'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
              'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
              'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
              'office:version="1.2">'
              '<office:styles/>'
              '<office:automatic-styles/>'
              '<office:master-styles/>'
              '</office:document-styles>')
    meta = ('<?xml version="1.0" encoding="UTF-8"?>'
            f'<office:document-meta {ns}>'
            '<office:meta><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">'
            f'{esc(title)}</dc:title></office:meta>'
            '</office:document-meta>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.text",
                   compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/manifest.xml", manifest)
        z.writestr("styles.xml", styles)
        z.writestr("meta.xml", meta)
        z.writestr("content.xml", content)
    return buf.getvalue()


def harvest_from_discovery(cands: dict[str, list[dict]]) -> list[dict]:
    out = []
    for ext, rows in cands.items():
        for rec in rows:
            out.append({"ext": ext, "url": rec["url"], "provenance": rec.get("provenance") or {},
                        "content_type": rec.get("type", "")})
    return out


def eml_from_spam_corpus(limit: int) -> list[dict]:
    """Apache SpamAssassin 公开语料里的真实邮件（一封一封原样取出，不改内容）。

    tar.bz2 是出版方的容器，`From ` 分隔的每条就是一封完整 RFC822 邮件；
    我做的只是「按它自己的分隔符拆成单文件」，所以标 `split-from-publisher-archive`。
    """
    blob, meta = fetch(SPAM_TARBALL, 6_000_000)
    if blob is None:
        print(f"  ✗ 邮件语料取不到：{meta.get('error')}")
        return []
    out: list[dict] = []
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:bz2") as tar:
        for member in tar.getmembers():
            if not member.isfile() or len(out) >= limit:
                continue
            fp = tar.extractfile(member)
            if fp is None:
                continue
            data = fp.read()
            ok, why = validate(".eml", data)
            if not ok:
                continue
            out.append({"ext": ".eml", "blob": data,
                        "url": f"{SPAM_TARBALL}#{member.name}",
                        "content_type": "message/rfc822",
                        "provenance": {"container": "split-from-publisher-archive",
                                       "package": member.name, "organization": "Apache SpamAssassin public corpus"},
                        "validate_note": why})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-format", type=int, default=PER_FORMAT)
    ap.add_argument("--refresh-discovery", action="store_true",
                    help="重新在线探测候选（默认复用 formats-candidates.json）")
    args = ap.parse_args()

    cand_path = ROOT / "formats-candidates.json"
    if args.refresh_discovery or not cand_path.exists():
        cands = discover()
        cand_path.write_text(json.dumps(cands, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        cands = json.loads(cand_path.read_text(encoding="utf-8"))

    OUT.mkdir(parents=True, exist_ok=True)
    picked: dict[str, list[dict]] = {ext: [] for ext in TARGETS}
    skipped: list[dict] = []

    # 1) .eml 走语料拆分（没有「单封邮件」的公共直链）
    for item in eml_from_spam_corpus(args.per_format):
        if len(picked[".eml"]) >= args.per_format:
            break
        picked[".eml"].append(item)

    # 2) 其余格式：按发现阶段的候选逐个下载 + 验容器
    for cand in harvest_from_discovery(cands):
        ext = cand["ext"]
        if ext not in picked or len(picked[ext]) >= args.per_format:
            continue
        blob, meta = fetch(cand["url"])
        if blob is None:
            skipped.append({**cand, "why": meta.get("error", "下载失败")})
            continue
        ok, why = validate(ext, blob)
        if not ok:
            skipped.append({**cand, "why": f"容器校验不过：{why}"})
            continue
        picked[ext].append({**cand, "blob": blob, "status": meta.get("status"),
                            "content_type": meta.get("content_type") or cand["content_type"],
                            "validate_note": why})

    # 3) .md / .markdown：白名单里它们都走 TextLoader。
    #    内容取真实正文（RFC 纯文本），容器是我按扩展名放的 —— 明确标 locally-wrapped。
    md_sources = {
        ".md": "https://www.rfc-editor.org/rfc/rfc2119.txt",
        ".markdown": "https://www.rfc-editor.org/rfc/rfc1918.txt",
    }
    for ext, url in md_sources.items():
        if len(picked[ext]) >= args.per_format:
            continue
        blob, meta = fetch(url)
        if blob is None:
            skipped.append({"ext": ext, "url": url, "why": meta.get("error", "")})
            continue
        ok, why = validate(ext, blob)
        if ok:
            picked[ext].append({
                "ext": ext, "url": url, "blob": blob, "status": meta.get("status"),
                "content_type": "text/plain", "validate_note": why,
                "provenance": {"container": "locally-wrapped", "package": url.rsplit("/", 1)[-1],
                               "organization": "IETF RFC Editor"}})

    # 4) 出版方原件不够四种 office 容器时，用**真实正文**装本地容器补上解析路径覆盖。
    #    .doc/.ppt（OLE 复合文档）本机没有写库能造（python-docx/pptx 只产 OOXML，
    #    也没有 soffice 可转换），所以它们**不补**——拿不到真实原件就如实写「未覆盖」。
    bank = real_content_bank()
    for ext in (".docx", ".pptx", ".xlsx", ".odt"):
        n = 0
        while len(picked[ext]) < args.per_format and bank:
            item = bank[(len(picked[ext]) + n) % len(bank)]
            n += 1
            if n > len(bank):
                break
            blob = wrap_office(ext, item)
            if not blob:
                break
            ok, why = validate(ext, blob)
            if not ok:
                skipped.append({"ext": ext, "url": item["url"], "why": f"自造容器不合格：{why}"})
                continue
            picked[ext].append({
                "ext": ext, "url": f"{item['url']}#wrapped-into-{ext.strip('.')}",
                "blob": blob, "status": "local", "content_type": "", "validate_note": why,
                "provenance": {"container": "locally-wrapped(real-content)",
                               "package": item["id"],
                               "organization": "容器本地生成，正文取自上一轮已验出处的真实文档"}})

    docs, manifest_gaps = [], []
    for ext, rows in picked.items():
        if not rows:
            manifest_gaps.append(ext)
        folder = OUT / ext.lstrip(".")
        folder.mkdir(parents=True, exist_ok=True)
        for n, item in enumerate(rows, 1):
            blob = item["blob"]
            raw_title = title_of(ext, blob)
            # 标题取不到时退回文件名。别在这里包一层 Path：slugify 要的是字符串，
            # 包了会把 Path 传进 re.sub（本轮就是这么在第一份文件上崩掉的）。
            name = item["url"].split("#")[0].split("?")[0].rsplit("/", 1)[-1]
            base = slugify(raw_title or name or f"{ext.strip('.')}-doc-{n}")
            doc_id = f"fmt-{ext.lstrip('.')}-{n:02d}-{base}"
            path = folder / f"{doc_id}{ext}"
            path.write_bytes(blob)
            text = ""
            if ext in (".md", ".markdown", ".txt", ".csv", ".eml", ".html"):
                text = blob.decode("utf-8", "replace")
            docs.append({
                "id": doc_id,
                "path": str(path.relative_to(ROOT)),
                "title": raw_title or f"（无标题，取文件名）{path.name}",
                "title_source": "document" if raw_title else "filename",
                "format": ext,
                "domain": ext.lstrip("."),
                "lang": lang_of(text) if text else "en",
                "tier": "real",
                "synthetic": False,
                "url": item["url"],
                "publisher": item.get("provenance", {}).get("organization") or "",
                "package": item.get("provenance", {}).get("package") or "",
                "container": item.get("provenance", {}).get("container", "publisher-native"),
                "bytes": len(blob),
                "sha256": hashlib.sha256(blob).hexdigest(),
                "content_type": item.get("content_type", ""),
                "status": item.get("status"),
                "container_check": item.get("validate_note", ""),
                "fetch": "new",
            })

    (OUT / "MANIFEST.json").write_text(json.dumps(
        {"documents": docs, "gaps": manifest_gaps,
         "skipped_candidates": skipped[:60]}, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# 多格式真实语料覆盖度", "",
             f"目标：应用白名单的 {len(TARGETS)} 个扩展名，每种最多 {args.per_format} 份真实文件。", "",
             "| 格式 | 份数 | 容器原件? | 出版方 | 字节范围 |", "| --- | --- | --- | --- | --- |"]
    for ext in TARGETS:
        rows = picked[ext]
        cont = {d["container"] for d in docs if d["format"] == ext}
        pubs = sorted({(d["publisher"] or "-") for d in docs if d["format"] == ext})[:3]
        sizes = [d["bytes"] for d in docs if d["format"] == ext]
        lines.append(f"| `{ext}` | {len(rows)} | {'、'.join(sorted(cont)) or '-'} | "
                     f"{' / '.join(pubs) or '-'} | "
                     f"{(f'{min(sizes):,}–{max(sizes):,}' if sizes else '-')} |")
    lines += ["", f"**没拿到真实文件的格式**：{', '.join('`'+g+'`' for g in manifest_gaps) or '无'}",
              f"**被容器校验挡下的候选**：{len(skipped)} 条（清单在 MANIFEST 的 skipped_candidates 里）", ""]
    (ROOT / "formats-coverage.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    if manifest_gaps:
        print(f"✗ 有格式一条真实文件都没拿到：{manifest_gaps}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
