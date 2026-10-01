"""检索中间态：**这一句为什么没答对**的证据。

#15 那条方向要的不是「聊天记录」，是一份能反查的标注数据集。要反查就得知道
答案背后的检索发生了什么：搜了哪些库、拿到几条、重排没重排、最高分多少、留下几条。
这些数字原来**一个都没留下** —— 引用只活在 Redis 的 `chat_ref:*` 里 600 秒，
十分钟后连「它当时看到了什么」都无法复原，更别说判断是库没内容还是阈值太狠。

只记**服务端当场能知道的事实**：
- 不记生成耗时/token 数（那些在这条路径上拿不到，硬凑就是假数据）；
- 不接受客户端上报任何一项（见 conversation.controller 的 `retrieval_session`：
  客户端只能给一个会话号，数字一律由服务端从 Redis 取回）。
"""

from json import dumps
from typing import Any, Iterable

# 比 chat_ref 的 600 秒长：答案生成完之后才落库，用户网络慢一点也不该把证据等没了。
TELEMETRY_TTL_SECONDS = 1800


def telemetry_key(user_id: int, session_id: str) -> str:
    # 键里带 user_id：别人的会话号换不回别人的检索中间态（与 chat_ref 同一套边界）。
    return f"chat_tel:{user_id}:{session_id}"


def score_span(items: Iterable[dict]) -> dict:
    """只从**真有分数**的条目里取 min/max。

    没有 relevance_score 的条目不参与 —— 把它们当 0 会让「没重排」看起来像「相关性为零」，
    而这两种情况的修法完全相反（前者是配置，后者是内容）。
    """
    scores = [
        item["relevance_score"]
        for item in items
        if isinstance(item.get("relevance_score"), (int, float))
    ]
    if not scores:
        return {"reranked": False}
    return {
        "reranked": True,
        "score_min": round(min(scores), 4),
        "score_max": round(max(scores), 4),
    }


def build_retrieval_telemetry(
    *,
    sources: list[tuple[str, str]],
    top_k: int,
    candidates: int,
    returned: int,
    scored: list[dict],
    elapsed_ms: int,
) -> dict[str, Any]:
    """一条问答的检索事实。字段少而硬，将来要加就再加，不预设。"""
    return {
        "sources": [{"database": db, "collection": col} for db, col in sources],
        "source_count": len(sources),
        "top_k": top_k,
        "candidates": candidates,
        "returned": returned,
        "elapsed_ms": elapsed_ms,
        # 三种「没答上」在这里是可区分的：库里没有 / 有但被阈值筛光 / 取回了但没用好。
        # 少了这一层，未解决队列只会退化成「模型又胡说了」的抱怨清单。
        "outcome": "no_hits" if candidates == 0 else ("filtered_out" if returned == 0 else "ok"),
        **score_span(scored),
    }


def dump_telemetry(redis_client, key: str, telemetry: dict) -> None:
    """写 Redis 不能拖垮主路径：Redis 抖动时答案照常给，证据这一路记不上就报错进日志。"""
    redis_client.setex(key, TELEMETRY_TTL_SECONDS, dumps(telemetry))
