"""xinference 管理/查询面的薄封装。

原则：**只转发与合并，不保存**。所有清单、状态、显存、参数、维度都直接来自服务器
（本机实测的端点见 `docs/DESIGN-2026-09-30-inference-model-management.md` §3）。
我们唯一自己持有的东西是 `bindings.py` 里那张三行表。

同步实现（httpx 同步客户端），由控制层用 `anyio.to_thread.run_sync` 包一层 ——
理由是这个包里的调用全都是「等一个外部 HTTP」，而 `AsyncSession` 不是并发安全的
（本机实测：五条查询 gather 共用一个 session 会抛 IllegalStateChangeError），
所以并发留给 HTTP、数据库操作留在各自的路由里顺序做。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional

from src.config import embedding_dimension, k, max_model_len, p

from . import auth
from .errors import XinferenceRejected, XinferenceUnavailable

# 服务器返回的 detail 会截断后带给界面：它是用户看得懂的那句话
# （"Model not found in the model list" 之类），但完整响应只进日志。
_DETAIL_MAX = 200

# 后台 launch 的失败暂存。这不是「模型状态的第二事实源」——
# 状态永远以 /v1/models 为准，这里只暂存**我们自己做的那次动作**为什么没成，
# 否则用户点了「加载」而列表里什么都没出现，就又是一次静默失效。
# 条目在该 uid 真的出现在运行清单后自动作废。
_launch_errors: Dict[str, Dict[str, Any]] = {}
_LAUNCH_ERROR_TTL = 1800.0


def _unwrap(status: int, body: Any, what: str) -> Any:
    if status in (200, 201, 202):
        return body
    detail = ""
    if isinstance(body, dict):
        detail = str(body.get("detail") or body.get("message") or "")
    elif isinstance(body, str):
        detail = body
    detail = detail.strip()[:_DETAIL_MAX]
    # 404 与 409 是「有信息的答案」，不是故障：原状态码往上带
    code = status if status in (400, 404, 409, 422) else 502
    raise XinferenceRejected(
        f"xinference {what} 未成功（HTTP {status}）"
        + (f"：{detail}" if detail else ""),
        status_code=code,
    )


def get(path: str, params: Optional[Dict[str, Any]] = None, timeout: float = 15.0) -> Any:
    status, body = auth.request("GET", path, params=params, timeout=timeout)
    return _unwrap(status, body, f"GET {path}")


def post(
    path: str,
    payload: Dict[str, Any],
    timeout: float = 60.0,
    params: Optional[Dict[str, Any]] = None,
) -> Any:
    status, body = auth.request("POST", path, json_body=payload, params=params, timeout=timeout)
    return _unwrap(status, body, f"POST {path}")


def put(path: str, payload: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Any:
    status, body = auth.request("PUT", path, json_body=payload, timeout=timeout)
    return _unwrap(status, body, f"PUT {path}")


def delete(path: str, timeout: float = 30.0) -> Any:
    status, body = auth.request("DELETE", path, timeout=timeout)
    return _unwrap(status, body, f"DELETE {path}")


# ── 读 ────────────────────────────────────────────────────────────────────


def running_models() -> List[Dict[str, Any]]:
    data = get("/v1/models") or {}
    return data.get("data", []) if isinstance(data, dict) else []


def autostart_entries() -> List[Dict[str, Any]]:
    data = get("/v1/autostart/models") or {}
    return data.get("models", []) if isinstance(data, dict) else []


def gpu_status() -> Dict[str, Any]:
    """显存来自 `/status` 的 worker 段（实测有 gpu-0.mem_total/mem_free/mem_usage）。

    不 scrape nvidia-smi：那是第二个事实源，而且它看到的和服务器看到的不是同一件事
    （比如别的进程占的显存，nvidia-smi 有、xinference 的调度判断没有）。
    """
    raw = get("/status", timeout=8.0) or {}
    workers = raw.get("workers") if isinstance(raw, dict) else None
    gpus: List[Dict[str, Any]] = []
    for w in (workers or {}).values():
        for key, dev in sorted((w or {}).get("status", {}).items()):
            if not key.startswith("gpu"):
                continue
            gpus.append(
                {
                    "id": key,
                    "name": dev.get("name"),
                    "mem_total": dev.get("mem_total"),
                    "mem_free": dev.get("mem_free"),
                    "mem_used": dev.get("mem_used"),
                    "mem_usage": dev.get("mem_usage"),
                    "gpu_util": dev.get("gpu_util"),
                }
            )
    return {"uptime": raw.get("uptime"), "gpus": gpus}


def cluster_version() -> Optional[str]:
    try:
        data = get("/v1/cluster/version", timeout=8.0) or {}
    except Exception:  # noqa: BLE001 版本读不到不该拖垮整个面板
        return None
    return data.get("version") if isinstance(data, dict) else None


def model_progress(model_uid: str) -> Dict[str, Any]:
    return get(f"/v1/models/{model_uid}/progress", timeout=10.0) or {}


def downloads() -> List[Dict[str, Any]]:
    data = get("/v1/downloads", timeout=10.0) or {}
    return data.get("list", []) if isinstance(data, dict) else []


def cached_weights() -> List[Dict[str, Any]]:
    data = get("/v1/cache/models", timeout=10.0) or {}
    return data.get("list", []) if isinstance(data, dict) else []


def engines_for(model_type: str, model_name: str) -> Dict[str, Any]:
    """哪个引擎能 serve 这个型号（实测 `/v1/engines/embedding/bge-m3` 直接给出答案）。

    这条替代了脚本里那段人肉提示（"Model not found in the model list" 常常是引擎不匹配）。
    """
    return get(f"/v1/engines/{model_type}/{model_name}", timeout=15.0) or {}


def versions_for(model_type: str, model_name: str) -> List[Dict[str, Any]]:
    """型号的具体版本条目，含 `dimensions` / `max_tokens` / `cache_status`（实测）。"""
    data = get(f"/v1/models/{model_type}/{model_name}/versions", timeout=15.0)
    return data if isinstance(data, list) else []


def embedding_dimensions(model_name: str) -> Optional[int]:
    """给换 embedding 的护栏用：维度不一致 = 已索引集合全部作废。"""
    for v in versions_for("embedding", model_name):
        dim = v.get("dimensions")
        if isinstance(dim, int) and dim > 0:
            return dim
    return None


def model_registrations(model_type: str) -> List[Dict[str, Any]]:
    """这个类型下，服务器**认识**哪些型号（实测：embedding 46 个、LLM 166 个、rerank 17 个）。

    加这条是因为管理页原来要求「先知道型号名再搜」，而空态写的是「在下方目录里选一个」——
    没有可浏览的清单，那句话就是句假话。列表只给 `{model_name, is_builtin}`，
    引擎/规格/维度仍然按选中的那一个去查（`/v1/engines/...`），不在这里预取 166 次。
    """
    data = get(f"/v1/model_registrations/{model_type}", timeout=20.0) or []
    return data if isinstance(data, list) else []


def model_families() -> Dict[str, List[str]]:
    return get("/v1/models/families", timeout=15.0) or {}


# ── 写 ────────────────────────────────────────────────────────────────────


def _prune_launch_errors(running_uids: set) -> None:
    now = time.monotonic()
    for uid in list(_launch_errors):
        age = now - _launch_errors[uid].get("at", 0)
        if uid in running_uids or age > _LAUNCH_ERROR_TTL:
            _launch_errors.pop(uid, None)


def launch_errors() -> Dict[str, Dict[str, Any]]:
    return dict(_launch_errors)


def _launch_job(payload: Dict[str, Any]) -> None:
    uid = str(payload.get("model_uid") or payload.get("model_name") or "")
    try:
        # wait_ready 走 query 参数（见 dto 里那条注释）：false 时服务器受理请求就返回，
        # 加载进度由界面轮 /v1/models/{uid}/progress（实测形状：
        # {"progress":0.0,"stage":"pending","download_files":[],"replicas":[]}）。
        post("/v1/models", payload, timeout=1800.0, params={"wait_ready": "false"})
        _launch_errors.pop(uid, None)
    except Exception as exc:  # noqa: BLE001
        # 失败必须留下痕迹：后台任务里抛出去没人看得见，界面上就是「点了没反应」。
        _launch_errors[uid] = {
            "error": f"{type(exc).__name__}: {str(exc)[:_DETAIL_MAX]}",
            "at": time.monotonic(),
        }
        return
    _watch_launch(uid)


# 「受理了却什么都没有发生」的看门狗。
_WATCH_SECONDS = 60.0
_WATCH_INTERVAL = 3.0


def _has_motion(uid: str, prog: Dict[str, Any]) -> bool:
    """这次动作有没有真的动起来。

    判据全部取自服务器现报的事实，不看时长：
    出现在运行清单 / 有了副本 / 开始下权重 / stage 离开 pending / progress 走了数值，
    任意一条都算「在动」，从此交回界面自己轮。
    """
    if any(uid == (m.get("model_uid") or m.get("id")) for m in running_models()):
        return True
    if prog.get("download_files") or prog.get("replicas"):
        return True
    if (prog.get("stage") or "").lower() not in ("", "pending"):
        return True
    return isinstance(prog.get("progress"), (int, float)) and prog["progress"] > 0


def _watch_launch(uid: str) -> None:
    """POST 回 200 **不等于**模型会起来。

    实测：加载一个不存在的 rerank 型号时，xinference 照样受理并返回，然后把任务挂在
    `{"progress":0.0,"stage":"pending","download_files":[],"replicas":[]}` 上，
    60 秒内 20 次采样一次都没动过。`_launch_job` 这边看不到任何异常，于是
    `launch_errors` 是空的、运行清单里也没有它 —— 界面只能一直显示「在途加载 0%」，
    而那正是本项目修过好几次的「点了没反应」，只是这次藏到了异步那一侧。

    所以发起这次动作的人负责盯「有没有动静」。没有动静就把这句话写成一次可见的失败：
    它陈述的是观察到的事实（60 秒内毫无动作），而不是假装知道服务器为什么不应。
    """
    deadline = time.monotonic() + _WATCH_SECONDS
    read_error = ""
    while time.monotonic() < deadline:
        time.sleep(_WATCH_INTERVAL)
        try:
            prog = model_progress(uid) or {}
            read_error = ""
        except Exception as exc:  # noqa: BLE001
            # 「这次读不到」不当成动静，但也**不能就此收工**。
            # 上一版这里是 `except: return`，注释写着「读不到本身就是一种动静」——
            # 可它恰好放过了最坏的那种情况：凭据过期或服务器 500 时进度永远读不到，
            # 于是既不写 launch_errors、也不进运行清单，界面就停在「在途 · 未知」上一直轮。
            # 现在继续盯到超时，并把最后一次的失败原因原样报出来。
            read_error = f"{type(exc).__name__}: {str(exc)[:160]}"
            continue
        if _has_motion(uid, prog):
            return
    _launch_errors[uid] = {
        "error": (
            f"服务器已受理，但 {int(_WATCH_SECONDS)} 秒内读不到这个 uid 的任何进度"
            f"（最后一次失败：{read_error}）。多半是凭据或服务器出问题了，"
            "先在管理页点「重新登录」，再回来卸载重试。"
            if read_error
            else (
                f"服务器已受理，但 {int(_WATCH_SECONDS)} 秒内没有任何动作"
                "（型号名不存在、类型选错、或本机跑不起来它）"
            )
        ),
        "at": time.monotonic(),
    }


def start_launch(payload: Dict[str, Any]) -> asyncio.Task:
    """把 launch 丢进后台。

    为什么必须后台：首次加载要拉 GB 级权重，同步等待的话这条 HTTP 请求一定先超时，
    而超时的请求在用户眼里就是「按钮没用」。返回 202 + 让界面轮 progress。

    先在**这里**（而不是 _launch_job 里）作废上一次同一 uid 的失败结论：
    界面用「运行清单里没有 + launch_errors 里没有」当作「这次还在途」的判据，
    留着旧条目的话这次尝试会被判成已落定 —— 既不显示在途、轮询也起不来，
    于是这次加载在界面上彻底隐形，正好复现了我们想修的那个「点了没反应」。
    """
    uid = str(payload.get("model_uid") or payload.get("model_name") or "")
    _launch_errors.pop(uid, None)
    return asyncio.get_running_loop().run_in_executor(None, _launch_job, payload)


def terminate(model_uid: str) -> Dict[str, Any]:
    """卸载模型。**幂等**：服务器报错时先看它是不是其实已经没了。

    实测：对一个带副本的 embedding 模型 `DELETE /v1/models/bge-m3` 会回
    `HTTP 400: Model not found in the model list, uid: bge-m3-rep0`
    —— 父 uid 的级联去删 `bge-m3-rep0` 时那个副本 actor 已经先退了。
    而紧接着 `/v1/models` 里确实已经没有这个模型。
    照原样把 400 抛给用户，就是「界面说失败、其实已经卸载了」，
    比失败更糟的是让人以为要再点一次。

    传输错误同理：拆模型（尤其带副本的）时服务器可能直接关掉连接，
    这时 `auth.request` 抛的是 `XinferenceUnavailable`。
    所以**两种失败都先去看运行清单** —— 清单里没有就是成功了，
    有才把错误原样报出去。判据是事实，不是响应码。
    """
    transport_error: Optional[Exception] = None
    try:
        status, body = auth.request("DELETE", f"/v1/models/{model_uid}")
    except XinferenceUnavailable as exc:
        status, body, transport_error = 0, str(exc), exc

    running_uids = {m.get("model_uid") or m.get("id") for m in running_models()}
    gone = model_uid not in running_uids
    if status in (200, 201, 202, 204) or gone:
        _launch_errors.pop(model_uid, None)
        detail = ""
        if isinstance(body, dict):
            detail = str(body.get("detail") or "")[:_DETAIL_MAX]
        elif isinstance(body, str) and transport_error is not None:
            detail = body[:_DETAIL_MAX]
        note = ""
        if status not in (200, 201, 202, 204):
            note = (
                "连接被服务器关闭，但该模型已不在运行清单，按已卸载处理"
                if transport_error is not None
                else "服务器返回了错误但模型已不在运行清单，按已卸载处理"
            )
        return {
            "model_uid": model_uid,
            "terminated": True,
            # 说清楚成功是**看运行清单**判出来的，不是服务器答"好"
            "note": note,
            "server_detail": detail,
        }
    if transport_error is not None:  # 传输错 + 模型还在跑：原样报，别编
        raise transport_error
    raise XinferenceRejected(
        f"卸载「{model_uid}」未成功（HTTP {status}）",
        status_code=status if status in (400, 404, 409) else 502,
    )


def set_autostart(entry: Dict[str, Any]) -> Any:
    return post("/v1/autostart/models", entry)


def clear_autostart(model_uid: str) -> Any:
    return delete(f"/v1/autostart/models/{model_uid}")


# ── 合并视图 ──────────────────────────────────────────────────────────────


def overview(bindings: Dict[str, Any]) -> Dict[str, Any]:
    """一次给全管理页要的东西。任何一块读不到都不该让整页变白，所以分别兜。

    共享的 `RESTfulClient` 也顺手报一下它拿没拿到凭据 —— 排查「后端能不能推理」时
    这是第一个要看的事实，而它以前完全不可见。
    """
    try:
        models = running_models()
    except Exception as exc:  # noqa: BLE001
        models = []
        models_error = type(exc).__name__
    else:
        models_error = None

    _prune_launch_errors({m.get("model_uid") or m.get("id") for m in models})

    def safe(fn, default):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            return default

    return {
        "endpoint": auth.base_url(),
        "version": safe(cluster_version, None),
        "reachable": models_error is None,
        "models_error": models_error,
        "models": models,
        "autostart": safe(autostart_entries, []),
        "gpu": safe(gpu_status, {"gpus": []}),
        "downloads": safe(downloads, []),
        "cached": safe(cached_weights, []),
        "bindings": bindings,
        "auth": auth.state(),
        "launch_errors": launch_errors(),
        # 后端自己有没有拿到凭据 —— 排查「服务都起了却答不上来」的第一手事实
        "client_has_credential": auth.has_credential(),
        # **应用侧的假设**。加载页要靠它才说得出「这么开会出事」：
        # `MAX_MODEL_LEN` 既是发给引擎的 `max_tokens`，也是 prompt 截断预算
        # （`src/llm/service.py`），所以「加载时填的上下文长度」与「运行时用的上下文长度」
        # 不一致是**可预见的坏**。而只有我们知道后者 —— xinference 的表单看不见 .env。
        "app": {
            "max_model_len": max_model_len,
            "top_k": k,
            "context_size": p,
            "embedding_dimension": embedding_dimension,
        },
    }
