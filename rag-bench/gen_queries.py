#!/usr/bin/env python
"""生成查询集（带**可核对的金标签**）：`rag-bench/queries.jsonl` + 人读版 `queries.md`。

为什么不能随手写几个问题就算基准：没有唯一、可核对的金标签，任何 recall 数字都无法证伪。
这里的做法是把每条查询绑到一个**在全语料里唯一出现**的片段上 —— 唯一性是算出来的
（对全库做子串计数），不是感觉出来的；不唯一的候选直接丢掉或改标成多标签样本。

四类查询：

  unique      片段只在一篇里出现 ⇒ 金标签唯一。测「该找到的能不能找到」。
  multi       片段在 2–4 篇里出现 ⇒ 金标签是集合。测多库/近重复下的召回完整度。
  unanswerable 片段在**全语料里一次都没有**（由真实词变形而来，且已核验为 0 命中）
              ⇒ 期望系统不要硬答。测阈值与「没答上」那条分支，这比测命中更容易暴露问题。
  hand        我按文档标题与主题手写的真实提问（跨语言、跨领域、含口语化说法）。
              这一类不是模板，用来检验前一类自动查询有没有把评测带偏成「关键词匹配比赛」。

用法（在 ingest 之后跑，因为金标签要落到服务端 doc_id）：
    apps/backend/.venv/bin/python rag-bench/gen_queries.py --per-doc 3
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent
# 清单在 main() 里按参数读，不在 import 期读：这样 gen_format_queries.py 才能安全地
# 复用下面这套出题规则（import 一个模块不该顺手读别人的语料清单）。
MANIFEST_PATH = ROOT / "MANIFEST.json"

CJK = re.compile(r"[\u4e00-\u9fff]{2,10}")
LAT = re.compile(r"[A-Za-z][A-Za-z0-9_+.\-]{4,24}")
NUMY = re.compile(r"\b\d[\d.,:/-]{2,}\b")

# 手写查询：gold 用的是 MANIFEST 里的 id（构建时就是确定值），不靠事后猜标题。
HAND_WRITTEN = [
    ("mdn-cors-zh", "浏览器什么时候会先发一个预检请求？", "zh"),
    ("mdn-cors-zh", "服务端要返回哪些响应头才允许跨域携带凭据？", "zh"),
    ("mdn-cache-zh", "max-age=0 和 no-cache 有什么区别？", "zh"),
    ("k8s-svc-zh", "Kubernetes 的 Service 有哪几种类型，分别用在什么场景？", "zh"),
    ("k8s-rbac-zh", "Role 和 ClusterRole 的差别是什么？", "zh"),
    ("py-sqlite-zh", "用 sqlite3 模块怎么避免 SQL 注入？", "zh"),
    ("py-csv-zh", "csv 模块里的 dialect 是干什么的？", "zh"),
    ("who-tb-zh", "肺结核的传播途径和主要症状有哪些？", "zh"),
    ("who-diabetes-zh", "糖尿病有两类吗？各自的特点是什么？", "zh"),
    ("rfc9110", "Which HTTP methods are defined as safe, and why does that matter?", "en"),
    ("rfc9110", "What does a 408 status code mean according to the spec?", "en"),
    ("rfc8446", "What changed in the TLS 1.3 handshake compared with earlier versions?", "en"),
    ("rfc6749", "Describe the authorization code grant flow.", "en"),
    ("rfc1149", "What is the maximum transmission unit for datagrams carried by avian hosts?", "en"),
    ("nist-63b", "What minimum password length does NIST SP 800-63B require?", "en"),
    ("owasp-a01", "What is broken access control and how is it exploited?", "en"),
    ("gutenberg-frankenstein", "Who is the narrator writing letters at the beginning of the novel?", "en"),
    ("mdn-a11y-zh", "写 HTML 时怎样让页面更容易被无障碍工具读取？", "zh"),
]

TEMPLATES = {
    "zh": ["关于「{span}」，文档里是怎么说明的？",
           "{span} 指的是什么？有什么使用上的注意点？",
           "请解释 {span} 在文中的作用。"],
    "en": ["What does the document say about {span}?",
           "In which context is {span} mentioned, and what is stated about it?",
           "Explain the role of {span} in this document."],
}


def clean_span(s: str) -> str:
    """候选片段必须**读起来像个词**。

    之前没有这一步，`[A-Za-z][A-Za-z0-9_+.-]{4,}` 会把句子里的 "results." 连句号一起吃掉，
    于是查询长成「Which documents mention results.?」—— 这种句子向量模型给的分数低，
    不是因为它检索不到，而是因为**问题本身是坏的**。基准测出来的是我的正则，不是系统。
    """
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip(".,;:!?。，、；：！？\"'“”‘’()（）[]【】<>《》|/\\*_~`\"-")
    if ".." in s or s.lower().startswith(("http://", "https://", "www.")):
        return ""
    # 论文/文档**自己的编号**不是可问的内容：arXiv 页面正文里就印着 arXiv:2609.36176，
    # 拿它当查询等于让系统在念自己的页码，检索一定成功，信息量为零。
    if re.fullmatch(r"(arxiv[:.\s]?[\d.\-]+|rfc\s?\d+|doi[:.\s]?[^\s]+)", s, re.I):
        return ""
    if re.search(r"arxiv[\W_]?\d{4}[.\-]\d{4,5}", s, re.I):
        return ""
    if not re.search(r"[A-Za-z\u4e00-\u9fff]{3,}", s):
        return ""
    if len(s) > 46:
        return ""
    return s


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).lower()


def load_bodies() -> dict[str, tuple[str, str, str]]:
    """id → (归一化全文, 原文, **纯正文**)。

    第三项是修一个自伤：构建脚本给每篇加了四行头（`来源:` / `领域: … | 语言: …` / 抓取日期），
    脏文档的标题里还带着「改造样本·boilerplate-shell」。这些字符串**只在本语料里出现**，
    于是"唯一性"判定会选中它们，做出「In which context is 改造样本·boilerplate-shell
    mentioned」这种问题 —— 系统答对不是因为检索到了内容，而是因为我们的水印本身就是语料里
    独一无二的词。测出来的分数和 RAG 能力无关。
    """
    out: dict[str, tuple[str, str, str]] = {}
    for d in MANIFEST["documents"]:
        if d.get("fetch") not in ("new", "skip", "rewrite"):
            continue
        path = ROOT / d["path"]
        if not path.exists():
            continue
        raw = path.read_text(encoding="utf-8", errors="replace")
        parts = raw.split("---\n", 1)
        body_only = parts[1] if len(parts) == 2 else raw
        out[d["id"]] = (norm(raw), raw, norm(body_only))
    return out


def candidate_spans(raw: str, domain: str) -> list[str]:
    """按「像术语、像数字、像专名」挑候选；不做词性幻想，只挑看得见的形状。"""
    out: list[str] = []
    for m in re.finditer(r"^(#{1,6})\s+(.+)$", raw, re.M):
        t = m.group(2).strip(" :：.,;")
        if 3 <= len(t) <= 42 and not t.startswith(("#", "-")):
            out.append(t)
    for m in re.finditer(r"^\*\*(.+?)\*\*$", raw, re.M):
        t = m.group(1).strip()
        if 3 <= len(t) <= 42:
            out.append(t)
    for m in re.finditer(LAT, raw):
        t = m.group(0)
        if ("_" in t or "." in t or "-" in t or t[:1].isupper()) and len(t) >= 6:
            out.append(t)
    for m in re.finditer(CJK, raw):
        if len(m.group(0)) >= 4:
            out.append(m.group(0))
    seen, uniq = set(), []
    for s in out:
        s = clean_span(s)
        if not s:
            continue
        k = s.lower()
        if k not in seen:
            seen.add(k)
            uniq.append(s)
    return uniq[:120]


def sentence_with(raw: str, span: str) -> str:
    idx = raw.lower().find(span.lower())
    if idx < 0:
        return ""
    start = max(0, raw.rfind("\n", 0, idx))
    end = raw.find("\n", idx + len(span))
    if end < 0:
        end = len(raw)
    return raw[start:end].strip()[:400]


STOP = {
    "uniform", "schemes", "evolution", "parsing", "incorrect", "miscellaneous", "microsoft",
    "behalf", "modern", "getting", "results", "character", "contributions", "materials",
    "unlimited", "federation", "information", "questions", "answers", "document", "documents",
    "example", "examples", "section", "version", "history", "contents", "overview", "summary",
    "introduction", "conclusion", "references", "copyright", "permission", "thanks",
}


def term_score(s: str) -> int:
    """像术语的程度：多词 / 带连接符 / 出现在标题里，都比一个孤零零的英文词更像「可问的东西」。"""
    n = 0
    if " " in s.strip():
        n += 3
    if re.search(r"[-_.+]", s):
        n += 2
    if CJK.search(s):
        n += 2
    if len(s) >= 10:
        n += 1
    if s.lower() in STOP:
        n -= 6
    return n


def main() -> int:
    global MANIFEST
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-doc", type=int, default=3, help="每篇最多产几条自动查询")
    ap.add_argument("--multi-gold", type=int, default=24, help="多标签查询的条数上限")
    ap.add_argument("--negatives", type=int, default=40, help="不可回答查询的条数")
    ap.add_argument("--seed", type=int, default=20260930)
    ap.add_argument("--manifest", default=str(MANIFEST_PATH))
    ap.add_argument("--queries-out", default="queries.jsonl")
    ap.add_argument("--md-out", default="queries.md")
    args = ap.parse_args()
    MANIFEST = json.loads(Path(args.manifest).read_text(encoding="utf-8"))

    rng = random.Random(args.seed)
    bodies = load_bodies()
    print(f"读入 {len(bodies)} 篇正文用于唯一性计数")

    counts: Counter[str] = Counter()
    for nid, (n, _raw, body_only) in bodies.items():
        # 每个 span 在**每篇文档里只计一次**：计次数会让「同一篇里出现三遍」被误判成跨文档。
        # 计数只用纯正文（去掉我们加的四行头），否则水印会参与"唯一"判定。
        for s in {c.lower() for c in candidate_spans(body_only, "") if clean_span(c)}:
            counts[s] += 1

    queries: list[dict] = []
    for d in MANIFEST["documents"]:
        if d["id"] not in bodies:
            continue
        _n, raw, body_only = bodies[d["id"]]
        lang = d["lang"] if d["lang"] in TEMPLATES else "en"
        cand = [s for s in candidate_spans(body_only, d["domain"])
                if counts[s.lower()] == 1 and term_score(s) >= 2]
        # 排序键是「像不像一个可问的术语」，不是出现顺序 —— 否则标题里第一个词永远中，
        # 而第一个词往往就是 Introduction / Results 这种放到哪篇都成立的东西。
        cand.sort(key=lambda s: (-term_score(s), -len(s)))
        picked = cand[:args.per_doc]
        for s in picked:
            tpl = rng.choice(TEMPLATES[lang])
            queries.append({
                "kind": "unique",
                "query": tpl.format(span=s),
                "gold": [d["id"]],
                "answer_span": s,
                "domain": d["domain"],
                "lang": lang,
                "tier": d["tier"],
                "synthetic_doc": d.get("synthetic", False),
            })

    # 多标签：跨文档出现的术语。**只取 2–6 篇**：
    # 「哪 26 篇提到了 contributions」不是一个检索问题，是让系统去数语料，指标会失去意义。
    multi_spans = [s for s, c in counts.items() if 2 <= c <= 6 and len(s) >= 7
                   and term_score(s) >= 2]
    rng.shuffle(multi_spans)
    taken = 0
    for s in multi_spans:
        gold = [i for i, (n, _r, b) in bodies.items() if s in b]
        if len(gold) < 2:
            continue
        queries.append({"kind": "multi", "query": f"哪些文档提到了 {s}？请都列出来。"
                        if CJK.search(s) else f"Which documents mention {s}? List all of them.",
                        "gold": gold, "answer_span": s, "domain": "cross",
                        "lang": "zh" if CJK.search(s) else "en", "tier": "n/a",
                        "synthetic_doc": False})
        taken += 1
        if taken >= args.multi_gold:
            break

    # 不可回答：变形后必须在全语料里 0 命中
    made = 0
    for s in multi_spans[:200]:
        fake = s[:-2] + rng.choice(["qa", "xz", "vv"]) + str(rng.randint(100, 999))
        if any(fake.lower() in b for _n, _r, b in bodies.values()):
            continue
        queries.append({"kind": "unanswerable",
                        "query": f"文档里关于 {fake} 有什么说明？" if CJK.search(s)
                        else f"What do the documents say about {fake}?",
                        "gold": [], "answer_span": fake, "domain": "negative", "lang": "en",
                        "tier": "n/a", "synthetic_doc": False})
        made += 1
        if made >= args.negatives:
            break

    for gid, q, lang in HAND_WRITTEN:
        if gid not in bodies:
            continue
        queries.append({"kind": "hand", "query": q, "gold": [gid], "answer_span": "",
                        "domain": next(d["domain"] for d in MANIFEST["documents"]
                                       if d["id"] == gid),
                        "lang": lang, "tier": "hand", "synthetic_doc": False})

    for i, q in enumerate(queries, 1):
        q["id"] = f"q{i:04d}"

    (ROOT / "queries.jsonl").write_text(
        "\n".join(json.dumps(q, ensure_ascii=False) for q in queries) + "\n", encoding="utf-8")

    by_kind: Counter[str] = Counter(q["kind"] for q in queries)
    lines = ["# RAG 基准查询集", "",
             f"共 {len(queries)} 条：唯一 {by_kind['unique']}、多标签 {by_kind['multi']}、"
             f"不可回答 {by_kind['unanswerable']}、手写 {by_kind['hand']}。", "",
             "每条的「金标签」是**必须被召回**的文档；`不可回答` 那批期望的是**不该被硬答**。",
             "想手动在界面上测：打开知识库的命中测试面板，把 query 原样粘进去即可。", ""]
    for q in queries:
        lines.append(f"- **{q['id']}** [{q['kind']}/{q['domain']}/{q['lang']}] {q['query']}")
        lines.append(f"  金标签: {', '.join(q['gold']) or '（无，应当拒答）'}")
    (ROOT / "queries.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"查询生成完成：{len(queries)} 条 → {dict(by_kind)}")
    if by_kind["unique"] < 150:
        print("提示：唯一型查询偏少，多半是语料重复度高或术语形状没匹配上；"
              "这会让基准偏软，不是好信号。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
