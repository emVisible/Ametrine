"""跨库 / 跨集合的结果融合。

为什么必须是 RRF 而不是「把分数排在一起」：`MILVUS_METRIC_TYPE=L2`，
两个集合的绝对距离没有共同基线（受各自语料的分布、维度、归一化习惯影响），
所以 A 库的 0.4 和 B 库的 0.4 不是同一件事。Dify 的多数据集就是直接
`sorted(result, key=lambda x: x.score, reverse=True)` 混排原始分数 —— 这条路我们不走。

RRF 只用**名次**：`score = Σ 1 / (k + rank)`，k=60 是信息检索里的惯例值
（Haystack 的 DocumentJoiner、LlamaIndex 的 QueryFusionRetriever、
Milvus 与 Supabase 的混合检索都是这个口径）。它有两个我们要的性质：
只依赖名次所以跨源可比；某个源整体占优时也不会把另一个源的第一名挤出去。
"""

from __future__ import annotations

RRF_K = 60


def rrf_merge(runs: list[list[dict]], k: int = RRF_K) -> list[dict]:
    """把多路检索结果融成一个序列。

    入参每一路是同一形状的命中列表，元素至少带
    `doc_id / chunk_id / distance / database_name / collection_name`。
    同一 (doc_id, chunk_id) 在**同一路**里重复出现只取最好名次（Milvus 不会这样返回，
    但去重放在这里比依赖上游更省事，也更难被将来的改动破坏）。

    返回按融合分数降序的列表；`relevance_score` 是融合分数（不是相似度，
    所以不能和 `min_relevance_score` 那个 0..1 阈值混用 —— 见 `score_kind`）。
    排序在分数相等时用「最好的一次距离」与标识符兜底，保证结果可复现。
    """
    merged: dict[tuple, dict] = {}
    for run in runs:
        seen_in_run: set[tuple] = set()
        for rank, hit in enumerate(run, start=1):
            key = (str(hit.get("doc_id")), hit.get("chunk_id"))
            if key in seen_in_run:
                continue
            seen_in_run.add(key)
            entry = merged.get(key)
            contribution = 1.0 / (k + rank)
            if entry is None:
                entry = {
                    "doc_id": hit.get("doc_id"),
                    "chunk_id": hit.get("chunk_id"),
                    "relevance_score": 0.0,
                    "score_kind": "rrf",
                    "best_distance": hit.get("distance"),
                    "sources": [],
                }
                merged[key] = entry
            entry["relevance_score"] += contribution
            distance = hit.get("distance")
            if distance is not None:
                current = entry["best_distance"]
                if current is None or distance < current:
                    entry["best_distance"] = distance
            source = {
                "database_name": hit.get("database_name"),
                "collection_name": hit.get("collection_name"),
                "rank": rank,
            }
            if source["database_name"] is not None:
                entry["sources"].append(source)

    return sorted(
        merged.values(),
        key=lambda item: (
            -item["relevance_score"],
            item["best_distance"] if item["best_distance"] is not None else float("inf"),
            str(item["doc_id"]),
            item["chunk_id"] if item["chunk_id"] is not None else -1,
        ),
    )
