#!/usr/bin/env python
"""标定 `MIN_RELEVANCE_SCORE`：不猜阈值，用实测的 rerank 分数分布算出来。

背景：全量基准里 rerank 模式的可找到率从 0.53 掉到 0.225 —— 排序本身没错，
是**绝对阈值把金标切掉了**。bge-reranker 在这套语料上给金标块的中位分只有 0.012 左右，
而配置里的阈值是 0.3。这个脚本要回答的是：阈值该是多少、以及「调到多少能救回多少」。

输出 `rag-bench/threshold.json` + 一张表：每个候选阈值下
  · 金标保留率（真正相关的块还剩多少能进 prompt）
  · 非金标通过率（噪声跟着进来多少 —— 这才是阈值的代价）
  · 有多少查询会变成「一条引用都没有」
"""

from __future__ import annotations

import asyncio
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "apps" / "backend"))

DB, COLL = "ragbench2026", "ragbench_all"
CANDIDATES = [0.0, 0.001, 0.003, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3]


async def main() -> int:
    from types import SimpleNamespace

    from sqlalchemy import text as sql_text

    from src.client import async_session, get_embedding_model, get_milvus_service, get_rerank_model
    from src.config import min_relevance_score, p
    from src.llm.service import LLMService
    from src.vector.documents.service import DocumentService

    emb = get_embedding_model()
    milvus = await get_milvus_service()
    doc_svc = DocumentService(milvus_service=milvus, relation_service=None,
                              llm_service=SimpleNamespace(embedding_model=emb))
    llm = LLMService(llm_model=None, embedding_model=emb, rerank_model=get_rerank_model(),
                     relation_service=None, tokenizer=None)

    queries = [json.loads(l) for l in
               (ROOT / "queries.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    mp = json.loads((ROOT / "ingest_map.json").read_text(encoding="utf-8"))
    sample = [q for q in queries if q["kind"] in ("unique", "hand", "multi")][:120]

    gold_scores, other_scores = [], []
    per_query: list[dict] = []
    # 只看排序、不看阈值：把「重排排得好不好」和「阈值切得狠不狠」分开回答。
    # 混在一起的话，rerank 模式 0.225 的找到率会被读成「重排模型没用」，
    # 而它其实可能只是被 0.3 一刀切掉了。
    rank_metrics = {"vector": {"hit@1": 0, "hit@3": 0, "rr": []},
                    "rerank": {"hit@1": 0, "hit@3": 0, "rr": []}}
    async with async_session() as s:
        for i, q in enumerate(sample, 1):
            hits = await doc_svc.document_query_service(
                database_name=DB, collection_name=COLL, data=q["query"], limit=10)
            pairs = [(str((h.get("entity") or {}).get("doc_id")),
                      (h.get("entity") or {}).get("chunk_id")) for h in hits]
            pairs = [(d, c) for d, c in pairs if c is not None]
            if not pairs:
                continue
            ids = [c for _d, c in pairs]
            rows = await s.execute(sql_text(
                "select id, doc_id, content from document_chunk where id = any(:ids) "
                "and enabled is not false"), {"ids": ids})
            texts = {(str(r[1]), r[0]): r[2] for r in rows}
            doc = [{"text": t, "doc_id": d, "chunk_id": c}
                   for (d, c), t in texts.items()]
            if not doc:
                continue
            res = await llm.rerank_loop(document=doc, question=q["query"])
            gold = {mp[g]["doc_id"] for g in q["gold"] if g in mp}
            row_scores = []
            rerank_order = []
            for item in res.get("results", []):
                md = item.get("metadata") or {}
                sc = float(item.get("relevance_score") or 0.0)
                is_gold = md.get("doc_id") in gold
                row_scores.append((sc, is_gold))
                rerank_order.append((sc, str(md.get("doc_id"))))
                (gold_scores if is_gold else other_scores).append(sc)
            per_query.append({"qid": q["id"], "scores": row_scores})
            # 向量顺序：候选本身就是 Milvus 按 L2 升序返回的，按文档去重保留最前一次
            vec_order = list(dict.fromkeys(
                str((h.get("entity") or {}).get("doc_id")) for h in hits))
            # 按**文档**去重（保留该文档的最高分块），再按分数降序
            best_by_doc: dict[str, float] = {}
            for sc, d in rerank_order:
                best_by_doc[d] = max(sc, best_by_doc.get(d, 0.0))
            rr_order = sorted(best_by_doc, key=lambda d: -best_by_doc[d])
            for name, order in (("vector", vec_order), ("rerank", rr_order)):
                first = next((i for i, d in enumerate(order) if d in gold), None)
                rank_metrics[name]["hit@1"] += 1 if order[:1] and order[0] in gold else 0
                rank_metrics[name]["hit@3"] += 1 if any(d in gold for d in order[:3]) else 0
                rank_metrics[name]["rr"].append(1.0 / (first + 1) if first is not None else 0.0)
            if i % 20 == 0:
                print(f"  {i}/{len(sample)}")

    def at(t: float) -> dict:
        kept_g = sum(1 for v in gold_scores if v >= t)
        kept_o = sum(1 for v in other_scores if v >= t)
        empty = sum(1 for r in per_query
                    if not any(v >= t for v, _g in r["scores"]))
        return {"threshold": t,
                "gold_kept": round(kept_g / max(1, len(gold_scores)), 4),
                "noise_kept": round(kept_o / max(1, len(other_scores)), 4),
                "queries_with_nothing": round(empty / max(1, len(per_query)), 4)}

    table = [at(t) for t in CANDIDATES]
    table.append({"threshold": min_relevance_score, "current": True, **at(min_relevance_score)})
    if gold_scores:
        table.append({"threshold": round(statistics.median(gold_scores), 4),
                      "note": "金标中位分（不是建议阈值，只是分布位置）"})

    n = max(1, len(per_query))
    ranking = {name: {"hit@1": round(v["hit@1"] / n, 4),
                      "hit@3": round(v["hit@3"] / n, 4),
                      "MRR": round(statistics.mean(v["rr"]), 4) if v["rr"] else None}
               for name, v in rank_metrics.items()}
    (ROOT / "threshold.json").write_text(json.dumps({
        "n_queries": len(per_query), "n_gold_scores": len(gold_scores),
        "n_other_scores": len(other_scores),
        "gold_median": round(statistics.median(gold_scores), 4) if gold_scores else None,
        "other_median": round(statistics.median(other_scores), 4) if other_scores else None,
        "configured": min_relevance_score, "p_per_answer": p,
        "ranking_ignoring_threshold": ranking,
        "sweep": table,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n金标 {len(gold_scores)} 块 / 非金标 {len(other_scores)} 块；"
          f"当前阈值 {min_relevance_score}")
    print("只看排序、不看阈值（同一批候选，两种顺序各自的指标）：")
    for name, v in ranking.items():
        print(f"  {name:>7}: hit@1={v['hit@1']} hit@3={v['hit@3']} MRR={v['MRR']}")
    print(f"{'阈值':>8} {'金标保留':>10} {'噪声通过':>10} {'无引用查询':>10}")
    for r in table:
        mark = "  ← 当前" if r.get("current") else ("  (金标中位)" if r.get("note") else "")
        print(f"{r['threshold']:>8} {r.get('gold_kept','-'):>10} "
              f"{r.get('noise_kept','-'):>10} {r.get('queries_with_nothing','-'):>10}{mark}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
