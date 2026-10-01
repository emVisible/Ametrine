"""推理面的**活性探测**：真的打一次，而不是问注册表。

为什么需要这一层（这一轮最贵的一条教训）：
gemma worker 进入 CUDA sticky device-side assert 之后，48/57 次请求全部回「成功的空回答」，
而 `GET /v1/models`、`/api/inference/overview`、`/health` 三处都显示模型在跑 ——
**「注册表可读」从来不等于「模型可用」**。既有的一切就绪判断都只证明了前者。

三条口径：
1. **不挂进 `/health`**。那条是 `dev.sh` 和容器每隔几秒打一次的，而一次真生成要花几秒到几十秒、
   还会占共享算力。就绪探针不能变成负载源，所以这里是「谁需要谁点一次」。
2. **顺序打，不并发**。三个角色共用这块卡，并发只会互相拖慢，把延迟数字弄得没法读。
3. **每个角色按自己的「能用」定义判**：llm 要有非空正文，embedding 要有向量**且维度对得上**
   （维度不对的话现在一切正常、写 Milvus 时才炸），rerank 要有结果 —— 而不是一句「HTTP 200」。
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional

from src.config import embedding_dimension

from . import bindings, service

# 探测用的输入刻意保持最短：这条路的目的是证明「模型能出东西」，不是测质量。
_PROBE_INPUT = "体检"
_LLM_PROMPT = "只回两个字：就绪"


def _reason(exc: BaseException) -> str:
    """探测失败要说清原因，但不把内部地址/进程号交给客户端。

    xinference 的报错原文长这样：`...（HTTP 404）：[address=127.0.0.1:52767, pid=575532] ...` ——
    对操作人有用的是「HTTP 404 / 模型没加载」，不是这台机器的监听地址与 pid。
    """
    text = str(exc).strip().replace("\n", " ")
    code = re.search(r"HTTP (\d{3})", text)
    kind = type(exc).__name__
    return f"{kind}（HTTP {code.group(1)}）" if code else f"{kind}: {text[:80]}"


def _fail(role: str, uid: str, detail: str, ms: Optional[float] = None) -> Dict[str, Any]:
    return {"role": role, "model_uid": uid, "ok": False, "latency_ms": ms, "detail": detail}


def _probe_llm(uid: str) -> Dict[str, Any]:
    t0 = time.monotonic()
    try:
        body = service.post(
            "/v1/chat/completions",
            {
                "model": uid,
                "messages": [{"role": "user", "content": _LLM_PROMPT}],
                "max_tokens": 16,
                "stream": False,
            },
            timeout=90.0,
        )
    except Exception as exc:  # noqa: BLE001
        return _fail("llm", uid, _reason(exc))
    ms = round((time.monotonic() - t0) * 1000)
    content = ""
    try:
        content = ((body or {}).get("choices") or [{}])[0].get("message", {}).get("content") or ""
    except Exception:  # noqa: BLE001
        content = ""
    if not str(content).strip():
        # 这一条就是那次事故的形状：HTTP 200、没有异常、正文是空的
        return _fail("llm", uid, "HTTP 200 但正文为空：worker 很可能已进 CUDA sticky 状态，"
                                "需要在管理台 terminate 再 launch 才能恢复", ms)
    return {"role": "llm", "model_uid": uid, "ok": True, "latency_ms": ms,
            "detail": f"回了 {len(str(content).strip())} 字"}


def _probe_embedding(uid: str) -> Dict[str, Any]:
    t0 = time.monotonic()
    try:
        body = service.post("/v1/embeddings", {"model": uid, "input": [_PROBE_INPUT]}, timeout=60.0)
    except Exception as exc:  # noqa: BLE001
        return _fail("embedding", uid, _reason(exc))
    ms = round((time.monotonic() - t0) * 1000)
    data = (body or {}).get("data") or []
    vec = (data[0].get("embedding") or []) if data else []
    if not vec:
        return _fail("embedding", uid, "HTTP 200 但没有向量", ms)
    if len(vec) != embedding_dimension:
        return _fail(
            "embedding", uid,
            f"维度 {len(vec)} 与 EMBEDDING_DIMENSION={embedding_dimension} 不一致："
            "现在看着正常，写进向量库时才会报字段维度不符", ms)
    return {"role": "embedding", "model_uid": uid, "ok": True, "latency_ms": ms,
            "detail": f"维度 {len(vec)} 与配置一致"}


def _probe_rerank(uid: str) -> Dict[str, Any]:
    t0 = time.monotonic()
    try:
        body = service.post(
            "/v1/rerank",
            {"model": uid, "query": _PROBE_INPUT, "documents": [_PROBE_INPUT, "无关的一句"], "top_n": 2},
            timeout=60.0,
        )
    except Exception as exc:  # noqa: BLE001
        return _fail("rerank", uid, _reason(exc))
    ms = round((time.monotonic() - t0) * 1000)
    results = (body or {}).get("results") or []
    if not results:
        return _fail("rerank", uid, "HTTP 200 但没有重排结果", ms)
    scores = [float(r.get("relevance_score") or 0.0) for r in results]
    return {"role": "rerank", "model_uid": uid, "ok": True, "latency_ms": ms,
            "detail": f"{len(results)} 条，分数区间 {min(scores):.4f}~{max(scores):.4f}"}


_PROBES = {"llm": _probe_llm, "embedding": _probe_embedding, "rerank": _probe_rerank}


def run(bound: Dict[str, str]) -> List[Dict[str, Any]]:
    """按当前绑定逐个真打一次。`bound` 由调用方给（路由那边已经读过绑定表了）。"""
    out: List[Dict[str, Any]] = []
    for role in bindings.ROLES:
        uid = (bound or {}).get(role) or ""
        probe = _PROBES.get(role)
        if probe is None:
            continue
        if not uid:
            out.append(_fail(role, uid, "这个角色没有绑定模型"))
            continue
        out.append(probe(uid))
    return out
