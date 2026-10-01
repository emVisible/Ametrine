#!/usr/bin/env python
"""给多格式语料造查询：金标片段取自**应用实际索引到的文本**。

为什么从索引文本而不是原件造题：原件里的独有词可能压根没进库（解析丢了），
那种题的「查不到」是保真度问题，不是检索问题 —— 两件事已经分开量了
（保真度见 `formats_fidelity.py`）。这里只问一个干净的问题：
**内容确实在库里，检索能不能按格式把它捞回来。**

唯一性是在整个已索引集合上数的，所以跨格式共有的词（License、http、章节名）
不会变成题；这类题本来就是多解，测出来的低分说明我的题坏，不说明系统坏。

用法：
    apps/backend/.venv/bin/python rag-bench/gen_format_queries.py --password '<基准账号口令>'
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_retrieval import call, unwrap  # noqa: E402  同一套 HTTP 与信封处理
from gen_queries import TEMPLATES, candidate_spans, clean_span, term_score  # noqa: E402

ROOT = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", required=True)
    ap.add_argument("--manifest", default="formats/MANIFEST.json")
    ap.add_argument("--map", default="ingest_formats_map.json", dest="map_name")
    ap.add_argument("--out", default="formats-queries.jsonl")
    ap.add_argument("--md-out", default="formats-queries.md")
    ap.add_argument("--per-doc", type=int, default=3)
    ap.add_argument("--seed", type=int, default=20261001)
    args = ap.parse_args()

    manifest = json.loads((ROOT / args.manifest).read_text(encoding="utf-8"))
    mapping = json.loads((ROOT / args.map_name).read_text(encoding="utf-8"))
    st, res = call("/auth", form={"username": "ragbench", "password": args.password}, method="POST")
    if st != 200:
        print(f"登录失败 {st}: {str(res)[:160]}")
        return 1
    tok = res["access_token"]

    indexed: dict[str, str] = {}
    chunk_count: dict[str, int] = {}
    for doc in manifest["documents"]:
        ent = mapping.get(doc["id"])
        if not ent:
            continue
        # `call()` 默认是 POST，这条只读接口必须显式 GET，否则 unwrap 出来是空列表，
        # 「这个格式没题可出」就成了我读法错误的假结论。
        st, res = call(f"/relation/document/chunk?doc_id={ent['doc_id']}",
                       tok=tok, method="GET")
        chunks = unwrap(res) or []
        if isinstance(chunks, list) and chunks:
            # 同上：字段是 `content`。按 `text` 取会拿到空串，然后「没题可出」被误读成
            # 「这个格式检索不了」。
            text = "\n".join(
                str(c.get("content") or c.get("text") or "") for c in chunks if isinstance(c, dict))
            if text.strip():
                indexed[doc["id"]] = text
                chunk_count[doc["id"]] = len(chunks)
    print(f"有索引文本的文档 {len(indexed)} 篇（映射到服务端 {len(mapping)} 篇）")

    # 每篇只计一次的集合值计数：跨篇出现过就不是"唯一"
    spans_per_doc = {d: {clean_span(s).lower() for s in candidate_spans(t, "")
                         if clean_span(s)} for d, t in indexed.items()}
    freq: dict[str, int] = {}
    for _d, s in spans_per_doc.items():
        for x in s:
            freq[x] = freq.get(x, 0) + 1

    rng = random.Random(args.seed)
    queries = []
    for doc in manifest["documents"]:
        text = indexed.get(doc["id"])
        if not text:
            continue
        cand = []
        for s in candidate_spans(text, doc.get("domain", "")):
            c = clean_span(s)
            if not c or len(c) < 5 or c.lower().startswith(("http", "www", "mailto", "@")):
                continue
            if freq.get(c.lower(), 0) != 1:
                continue
            if term_score(c) < 2:
                continue
            cand.append(c)
        cand.sort(key=lambda s: (-term_score(s), -len(s)))
        lang = doc.get("lang", "en")
        # TEMPLATES[lang] 是**一组**句式，不是单条模板：直接 .format 会 AttributeError，
        # 而更早一次的写法（取 [0]）会让同一格式的所有题都长成一句话。
        pool = TEMPLATES[lang if lang in TEMPLATES else "en"]
        for s in cand[:args.per_doc]:
            queries.append({
                "id": f"f{len(queries) + 1:04d}",
                "kind": "unique",
                "query": rng.choice(pool).format(span=s),
                "gold": [doc["id"]],
                "answer_span": s,
                "domain": doc["format"].lstrip("."),
                "format": doc["format"],
                "lang": lang,
                "tier": doc.get("container", "real"),
                "chunks": chunk_count[doc["id"]],
                "span_in_query": True,   # 这类题的题面必然含片段，答案侧指标别用它
            })
        if not cand:
            print(f"  · {doc['format']} {doc['id'][:28]:<30} 索引文本里没有全库唯一的可问片段")

    (ROOT / args.out).write_text(
        "\n".join(json.dumps(q, ensure_ascii=False) for q in queries) + "\n", encoding="utf-8")

    lines = ["# 多格式语料的手动测试题", "",
             f"共 {len(queries)} 条，金标片段全部取自**应用索引后的分块文本**，",
             "所以每条的答案一定在库里；查不到就是检索/排序的问题，不是解析丢了内容。", "",
             "| 题号 | 格式 | 容器 | 语言 | 问题 | 金标片段 | 应命中文档 | 该文档块数 |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    by_fmt: dict[str, int] = {}
    for q in queries:
        by_fmt[q["format"]] = by_fmt.get(q["format"], 0) + 1
        d = next(x for x in manifest["documents"] if x["id"] == q["gold"][0])
        lines.append(f"| {q['id']} | `{q['format']}` | {d['container']} | {q['lang']} | "
                     f"{q['query'][:58]} | `{q['answer_span'][:26]}` | {d['id'][:26]} | {q['chunks']} |")
    lines += ["", "每格式题数：" + json.dumps(by_fmt, ensure_ascii=False)]
    (ROOT / args.md_out).write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\n生成 {len(queries)} 条查询，按格式：{json.dumps(by_fmt, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
