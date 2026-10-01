#!/usr/bin/env python
"""RAG 检索准确度评测：对每条查询走**应用自己的召回面**，算指标并落盘。

测的是哪条链：`POST /api/relation/document/recall` —— 它就是界面上「命中测试」那个面板背后的
同一条路（向量召回 → 可选 rerank → 引用解析），**刻意不调大模型**。
选它有三个理由：不花推理配额、没有生成噪声混进检索指标、而且和用户在界面上手动测的完全同一条路。

`--modes vector,rerank` 各跑一遍，于是能回答一个只有基准才能回答的问题：
**rerank 到底把顺序改好了多少**（同一批候选，两种排序的 hit/MRR/nDCG 差值），
而不是只看「最终答案对不对」那种把三件事混在一起的数字。

产物：
    rag-bench/results.json    每条查询的原始命中（可复核）+ 汇总
    rag-bench/report.md       人读报告：总体、分领域、分语言、分质量档、阈值判别、最差的 20 条

用法：
    apps/backend/.venv/bin/python rag-bench/eval_retrieval.py --password '<基准账号口令>'
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get("AMETRINE_BENCH_BASE", "http://127.0.0.1:3000/api")
KS = (1, 3, 5, 10)


def unwrap(res):
    """剥统一响应信封。

    上一版没剥，直接 `res.get("results")` ⇒ 永远拿到空列表 ⇒ 报告里 hit@10=0.0，
    看起来像「检索一塌糊涂」，实际上是我的评测脚本读错了层。
    这类错误最危险的地方是**它会产出看起来合理的差结果**，不会报错。
    """
    if isinstance(res, dict) and "data" in res and "code" in res:
        return res.get("data") or {}
    return res or {}


def call(path: str, *, jsonbody=None, form=None, tok: str | None = None, method: str = "POST",
         timeout: int = 120):
    data = None
    headers = {}
    if tok:
        headers["Authorization"] = "Bearer " + tok
    if jsonbody is not None:
        data = json.dumps(jsonbody).encode()
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw or b"null")
            except Exception:  # noqa: BLE001
                return r.status, {"raw": raw[:200].decode("utf-8", "replace")}
    except HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"null")
        except Exception:  # noqa: BLE001
            return e.code, {"raw": raw[:200].decode("utf-8", "replace")}
    except URLError as e:
        return "ERR", {"error": str(e.reason)}


def dcg(hits: list[int]) -> float:
    return sum(h / math.log2(i + 2) for i, h in enumerate(hits))


def score_one(gold: list[str], ranked_ids: list[str]) -> dict:
    """单条查询的检索指标。gold 为空 = 不可回答样本，只记「有没有被误召回」。

    先按文档去重（保留最靠前的那次）：一篇文档被切成 10 块时，向量检索可以同时返回它的
    好几块。不去重的话 hit@k 会因 chunk 数虚高，nDCG 甚至能算出大于 1 ——
    而这道题问的是「该找到的文档有没有找到」，不是「同一个文档被命中几次」。
    """
    ranked = list(dict.fromkeys(ranked_ids))
    out: dict[str, object] = {"ranked": ranked[:10]}
    if not gold:
        out["answerable"] = False
        return out
    gset = set(gold)
    hits = [1 if r in gset else 0 for r in ranked]
    first = next((i for i, r in enumerate(ranked) if r in gset), None)
    out["answerable"] = True
    out["rank_of_first"] = first
    out["recall@1"] = 1.0 if hits[:1] and hits[0] else 0.0
    for k in KS:
        out[f"hit@{k}"] = 1.0 if any(hits[:k]) else 0.0
        out[f"recall@{k}"] = (len(gset & set(ranked[:k])) / len(gset)) if gset else 0.0
    out["rr"] = (1.0 / (first + 1)) if first is not None else 0.0
    # 理想 DCG 必须是「金标全部排在最前面」的那个值，不是「实际找到的那几个重排一下」。
    # 用后者做分母，任何一条命中都会算出接近 1 的 nDCG（25 条冒烟时算出过 0.985，
    # 而同一批的 hit@10 只有 0.56）—— 那不是指标，是自欺。
    ideal = [1] * min(len(gset), 10) + [0] * max(0, 10 - len(gset))
    idcg = dcg(ideal)
    out["ndcg@10"] = (dcg(hits[:10]) / idcg) if idcg else 0.0
    return out


def summarize(rows: list[dict]) -> dict:
    keys = [f"hit@{k}" for k in KS] + [f"recall@{k}" for k in KS] + ["rr", "ndcg@10"]
    ans = [r for r in rows if r.get("answerable")]
    out = {"n": len(rows), "n_answerable": len(ans)}
    for k in keys:
        vals = [r.get(k) for r in ans if isinstance(r.get(k), (int, float))]
        out[k] = round(sum(vals) / len(vals), 4) if vals else None
    mrr = [r["rr"] for r in ans]
    out["MRR"] = round(sum(mrr) / len(mrr), 4) if mrr else None
    ranks = [r["rank_of_first"] for r in ans if r.get("rank_of_first") is not None]
    out["found_rate"] = round(len(ranks) / len(ans), 4) if ans else None
    # rank_of_first 是 0 起的位置；报告里写「median_rank 0」会让人以为在排第 0 名。
    out["median_rank_1based"] = int(statistics.median(ranks)) + 1 if ranks else None
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", required=True)
    ap.add_argument("--database", default="ragbench2026")
    ap.add_argument("--collection", default="ragbench_all")
    ap.add_argument("--by-domain", action="store_true", help="按领域各自的集合评测")
    ap.add_argument("--modes", default="vector,rerank")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--top-k", type=int, default=10)
    # 同一份评测要能跑「.md 主语料」和「多格式语料」两套输入 —— 复制脚本会变成
    # 第二份「指标怎么算」的事实源，两套数字就没法对比了。
    ap.add_argument("--queries", default="queries.jsonl")
    ap.add_argument("--map", default="ingest_map.json", dest="map_name")
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--report", default="report.md")
    args = ap.parse_args()

    st, res = call("/auth", form={"username": "ragbench", "password": args.password},
                   method="POST")
    if st != 200:
        print(f"登录失败 {st}: {str(res)[:160]}")
        return 1
    tok = res["access_token"]

    queries = [json.loads(l) for l in (ROOT / args.queries).read_text(encoding="utf-8").splitlines() if l.strip()]
    mapping = json.loads((ROOT / args.map_name).read_text(encoding="utf-8"))
    if args.limit:
        queries = queries[:args.limit]
    # 金标签从「构建期 id」翻到「服务端 doc_id」。翻不到的查询直接剔除并计数 ——
    # 拿一个不存在于库里的 gold 去算 hit@k，得到的是假的低分，比剔除更坏。
    usable, dropped = [], 0
    for q in queries:
        gids = [mapping[g]["doc_id"] for g in q["gold"] if g in mapping and mapping[g].get("doc_id")]
        if q["kind"] == "unanswerable":
            usable.append({**q, "gold_ids": []})
        elif len(gids) == len(q["gold"]):
            usable.append({**q, "gold_ids": gids})
        else:
            dropped += 1
    print(f"可评查询 {len(usable)} 条（剔除 {dropped} 条：金标签文档没在库里）")

    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    results: dict[str, list[dict]] = {}
    latency: dict[str, list[float]] = {m: [] for m in modes}
    errors: list[dict] = []

    for mode in modes:
        rows: list[dict] = []
        truncated: list[int] = []
        for i, q in enumerate(usable, 1):
            coll = q.get("domain") and args.by_domain and f"ragbench_{q['domain']}" or args.collection
            if q["kind"] == "multi" or not args.by_domain:
                coll = args.collection
            t0 = time.perf_counter()
            if mode == "raw":
                # 原始候选：`/vector/document/search` 就是 document_query_service 本身，
                # 没有后面的排序与截断 —— 只有在这一层，top_k=10 才真的能拿到 10 条。
                st, res = call("/vector/document/search", tok=tok, jsonbody={
                    "database_name": args.database,
                    "collection_name": coll,
                    "data": q["query"],
                    "limit": args.top_k,
                })
                data = unwrap(res)
                items = data if isinstance(data, list) else (data.get("results") or [])
                ranked = [str(h.get("doc_id") or (h.get("entity") or {}).get("doc_id"))
                          for h in items]
                top_score = None
                returned = len(ranked)
            else:
                st, res = call("/relation/document/recall", tok=tok, jsonbody={
                    "database_name": args.database,
                    "collection_name": coll,
                    "query": q["query"],
                    "top_k": args.top_k,
                    "rerank": mode == "rerank",
                })
                data = unwrap(res)
                returned = data.get("returned")
                truncated.append((data.get("candidate_count") or 0, returned or 0))
                ranked = [str(h.get("doc_id")) for h in (data.get("results") or [])]
                top_score = max((h.get("relevance_score") or 0)
                                for h in (data.get("results") or [{}])) \
                    if data.get("results") else None
            dt = time.perf_counter() - t0
            if st != 200:
                errors.append({"mode": mode, "qid": q["id"], "status": st, "err": str(res)[:160]})
                print(f"  ✗ {mode} {q['id']} → {st} {str(res)[:100]}")
                continue
            row = {"qid": q["id"], "kind": q["kind"], "domain": q["domain"], "lang": q["lang"],
                   "tier": q["tier"], "query": q["query"], "mode": mode,
                   "top_score": top_score, "returned": returned,
                   "latency_ms": round(dt * 1000, 1)}
            row.update(score_one(q["gold_ids"], ranked))
            rows.append(row)
            latency[mode].append(dt)
            if i % 40 == 0:
                print(f"  {mode}: {i}/{len(usable)}")
        results[mode] = rows
        if truncated:
            caps = Counter(c for _c, r_ in [(a, b) for a, b in truncated] for c in [r_])
            print(f"  [{mode}] 送 top_k={args.top_k} 实际返回条数分布: {dict(caps)}"
                  f"  ← 被 context_size 截断，@5/@10 在这一层量不到")

    (ROOT / args.out).write_text(json.dumps({
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "database": args.database, "collection": args.collection,
        "top_k": args.top_k, "modes": modes,
        "n_queries": len(usable), "dropped_unmatched_gold": dropped,
        "errors": errors[:40], "n_errors": len(errors),
        "summary": {m: summarize(r) for m, r in results.items()},
        "by_domain": {m: {d: summarize([r for r in rows if r["domain"] == d])
                          for d in sorted({r["domain"] for r in rows})}
                      for m, rows in results.items()},
        "by_lang": {m: {l: summarize([r for r in rows if r["lang"] == l])
                        for l in sorted({r["lang"] for r in rows})}
                    for m, rows in results.items()},
        "by_tier": {m: {l: summarize([r for r in rows if r["tier"] == l])
                        for l in sorted({r["tier"] for r in rows})}
                    for m, rows in results.items()},
        "by_kind": {m: {l: summarize([r for r in rows if r["kind"] == l])
                        for l in sorted({r["kind"] for r in rows})}
                    for m, rows in results.items()},
        "rows": results,
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    lines = ["# RAG 检索准确度报告", "",
             f"库 `{args.database}` / 集合 `{args.collection}`，top_k={args.top_k}，"
             f"查询 {len(usable)} 条（剔除 {dropped} 条金标签不匹配的），"
             f"错误 {len(errors)} 次。", ""]
    for m in modes:
        s = summarize(results[m])
        lines += [f"## 模式：{m}", "",
                  "| 指标 | 值 |", "|---|---|"]
        for k in ("n_answerable", "hit@1", "hit@3", "hit@5", "hit@10",
                  "recall@5", "recall@10", "MRR", "ndcg@10", "found_rate",
                  "median_rank_1based"):
            lines.append(f"| {k} | {s.get(k)} |")
        if latency[m]:
            lines.append(f"| 延迟中位 / p95 (ms) | {int(statistics.median(latency[m])*1000)} / "
                         f"{int(sorted(latency[m])[int(len(latency[m])*0.95)-1]*1000)} |")
        lines.append("")
    lines += ["## 分领域（各模式 hit@5 / MRR）", "", "| 领域 | 条数 | " +
              " | ".join(f"{m} hit@5 / MRR" for m in modes) + " |", "|---|---|" +
              "---|" * len(modes)]
    domains = sorted({r["domain"] for rows in results.values() for r in rows})
    for d in domains:
        cells = []
        for m in modes:
            sub = summarize([r for r in results[m] if r["domain"] == d])
            cells.append(f"{sub.get('hit@5')} / {sub.get('MRR')}")
        n = len([r for r in results[modes[0]] if r["domain"] == d])
        lines.append(f"| {d} | {n} | " + " | ".join(cells) + " |")
    lines += ["", "## 不可回答样本：分数分布（阈值能不能把它和真问题分开）", ""]
    for m in modes:
        neg = [r["top_score"] for r in results[m]
               if r["kind"] == "unanswerable" and r.get("top_score") is not None]
        pos = [r["top_score"] for r in results[m]
               if r["kind"] != "unanswerable" and r.get("top_score") is not None]
        if neg and pos:
            lines += ["", f"### {m}", "",
                      f"- 真问题 top 分数：中位 {statistics.median(pos):.4f}，"
                      f"5% 分位 {sorted(pos)[int(len(pos)*0.05)]:.4f}",
                      f"- 假问题 top 分数：中位 {statistics.median(neg):.4f}，"
                      f"95% 分位 {sorted(neg)[int(len(neg)*0.95)-1]:.4f}",
                      "- 这两组重叠多少，就是「该拒答却硬答」的比例上限。"]
    worst = sorted((r for r in results[modes[-1]] if r.get("answerable")),
                   key=lambda r: (r.get("rank_of_first") is None, -(r.get("rank_of_first") or 0)))
    lines += ["", "## 最差的 20 条（排在最远或根本没召回）", "",
              "| id | 领域 | 档 | 查询 | 首次命中位次 |", "|---|---|---|---|---|"]
    for r in worst[:20]:
        lines.append(f"| {r['qid']} | {r['domain']} | {r['tier']} | "
                     f"{r['query'][:60]} | {r.get('rank_of_first')} |")
    (ROOT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    for m in modes:
        s = summarize(results[m])
        print(f"\n[{m}] hit@1={s['hit@1']} hit@5={s['hit@5']} hit@10={s['hit@10']} "
              f"MRR={s['MRR']} nDCG@10={s['ndcg@10']} found={s['found_rate']}")
    print(f"\nEVAL_DONE queries={len(usable)} errors={len(errors)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
