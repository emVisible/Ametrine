"""推理管理面（全部只允许管理员）。

为什么整面收管理员：这里能加载/卸载模型、能改「系统用哪个模型答题」，
也能看到服务器地址、显存与凭据状态 —— 这些都不是普通用户该有也没有意义的能力。
闸门用现成的 `get_admin_user` 挂在 router 的 dependencies 上，
所以**新加路由不会漏判**（漏判是之前 `/user/permission/**` 那类洞的成因）。

同步的 httpx 调用一律 `to_thread`：路由是 async 的，直接在事件循环里等外部 HTTP
会把整个 worker 卡住（这台机器在分词器上就是这么把每个请求拖成 69 秒的）。
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.client import get_relation_db
from src.config import embedding_dimension
from src.models import Document
from src.user.auth.service import get_admin_user

from . import auth, bindings, liveness, service
from .dto import MODEL_TYPES, AutostartBody, BindingBody, LaunchBody

route_inference = APIRouter(
    prefix="/inference",
    tags=["Inference"],
    dependencies=[Depends(get_admin_user)],
)


async def _call(fn, *args, **kwargs) -> Any:
    return await anyio.to_thread.run_sync(lambda: fn(*args, **kwargs))


# ── 读 ────────────────────────────────────────────────────────────────────


async def _fresh_bindings(db: AsyncSession) -> Dict[str, Any]:
    """快照过期就去库里重灌一次。

    这一句是给**多 worker** 准备的：改绑定的那个进程会立刻失效自己的缓存，
    但别的 worker 不知道。没有这层 TTL 的话，就是「界面显示已换、一部分请求还在用旧模型」
    —— 和昨晚那条 `crossBase` 漏依赖是同一类缺陷，只是换了个尺度。
    """
    if bindings.stale():
        await bindings.refresh(db)
    return bindings.snapshot()


@route_inference.get("/overview", summary="推理面板总览：运行中模型、显存、autostart、绑定与凭据")
async def overview(db: AsyncSession = Depends(get_relation_db)) -> Dict[str, Any]:
    snap = await _fresh_bindings(db)
    return await _call(service.overview, snap)


@route_inference.get("/bindings", summary="三个角色当前绑定的模型")
async def get_bindings(db: AsyncSession = Depends(get_relation_db)) -> Dict[str, Any]:
    return await _fresh_bindings(db)


@route_inference.post(
    "/liveness",
    summary="活性探测：按当前绑定真的打一次 llm / embedding / rerank",
    responses={200: {"description": "永远 200 —— 探测失败是**要报告的结果**，不是这次请求的失败"}},
)
async def run_liveness(db: AsyncSession = Depends(get_relation_db)) -> Dict[str, Any]:
    """这条路由存在的理由：**注册表可读 ≠ 模型可用**。

    本机事故记录：worker 进入 CUDA sticky 状态后 48/57 次请求全回空回答，
    而 `/v1/models`、`/inference/overview`、`/health` 三处都显示模型在跑。
    所有既有的就绪判断都只证明了「它登记着」，没有人证明「它出得来字」。

    刻意不并进 `/health`：那条是启动脚本和容器每隔几秒打一次的，
    而一次真生成要花几秒到几十秒、还会占共享算力 —— 就绪探针不该变成负载源。
    也刻意不用非 2xx 表达失败：三个角色里有一个不可用是「这个系统的当前状态」，
    把它写成 HTTP 错误会让调用方以为探测本身没跑起来。
    """
    snapshot = await _fresh_bindings(db)
    bound = {item["role"]: item["model_uid"] for item in snapshot.get("roles") or []}
    # 函数名不能叫 `liveness`：那会在这个模块的命名空间里盖掉 `from . import liveness`，
    # 于是下一行变成「function object has no attribute run」（实测就是这么炸的）。
    probes = await _call(liveness.run, bound)
    return {"probes": probes, "all_ok": bool(probes) and all(p["ok"] for p in probes)}


@route_inference.get("/catalog", summary="某个型号能用什么引擎、有哪些版本（含维度）")
async def catalog(
    model_type: str = Query(..., min_length=1),
    model_name: str = Query(..., min_length=1),
) -> Dict[str, Any]:
    engines, versions = await asyncio.gather(
        _call(service.engines_for, model_type, model_name),
        _call(service.versions_for, model_type, model_name),
    )
    return {"engines": engines, "versions": versions}


@route_inference.get("/registrations", summary="某个类型下服务器认识的型号名（目录的第一层）")
async def registrations(model_type: str = Query(..., min_length=1)) -> Dict[str, Any]:
    """先列名字，再按选中的名字去查引擎与版本。

    类型必须是服务器认识的那几个：拼错的话 xinference 那边是 404/500，
    而我们这里能直接说清该填什么，所以先挡住。
    """
    if model_type not in MODEL_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"model_type 只接受 {'/'.join(MODEL_TYPES)} 之一，收到 {model_type!r}",
        )
    rows = await _call(service.model_registrations, model_type)
    return {"model_type": model_type, "models": rows}


@route_inference.get(
    "/families",
    summary="模型家族清单（按**能力**分组：chat/tools/vision/…，不是按 model_type）",
)
async def families() -> Dict[str, List[str]]:
    """留着它是因为概览页会显示「这台服务器认识多少种对话模型」。

    ⚠ 别拿它当目录的第一层：实测它的键是 `chat`/`tools`/`vision` 这种能力名，
    而且**完全不含 embedding 与 rerank**（`bge-m3` 不在任何一项里）。
    「这个类型下有哪些型号」要用 `/registrations?model_type=`。
    """
    return await _call(service.model_families)


@route_inference.get("/models/{model_uid}/progress", summary="加载进度")
async def progress(model_uid: str) -> Dict[str, Any]:
    return await _call(service.model_progress, model_uid)


# ── 写 ────────────────────────────────────────────────────────────────────


@route_inference.post(
    "/models",
    status_code=status.HTTP_202_ACCEPTED,
    summary="加载模型（提交后台任务，立刻返回；进度用 /models/{uid}/progress 轮）",
)
async def launch(body: LaunchBody) -> Dict[str, Any]:
    payload = body.to_launch_payload()
    uid = payload["model_uid"]
    if body.autostart:
        # 先登记再加载：登记失败（参数不合服务器要求）时就该在这里报错，
        # 而不是「模型加载了但下次重启不会自己回来」这种要人自己发现的事。
        await _call(service.set_autostart, body.autostart_entry())
    service.start_launch(payload)
    return {"model_uid": uid, "accepted": True, "autostart": body.autostart}


@route_inference.delete("/models/{model_uid}", summary="卸载模型（释放显存）")
async def terminate(model_uid: str) -> Dict[str, Any]:
    bound = {r["model_uid"] for r in bindings.snapshot()["roles"]}
    if model_uid in bound:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"「{model_uid}」是当前某个角色的绑定模型，先把绑定换走再卸载。",
        )
    # 直接透传 service 的结果：里面带着「是按运行清单判定成功的」这类说明，
    # 在这里重新拼一遍就把那句真话丢了。
    return await _call(service.terminate, model_uid)


@route_inference.put("/models/{model_uid}/autostart", summary="登记/更新自启动")
async def set_autostart(model_uid: str, body: AutostartBody) -> Dict[str, Any]:
    """用 launch_history 里那次真实参数登记，不猜。

    没有历史记录就明确 409：自己拼一个 launch payload 去登记，
    等于让服务器下次启动时按**我们编的参数**加载模型（引擎、量化、长度都可能不对）。
    """
    history = await _call(_launch_history, model_uid)
    if not history:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"「{model_uid}」没有 launch 历史记录，无法登记自启动。"
                "请从管理页的「加载模型」走一次（那里带的是服务器目录里的真实参数）。"
            ),
        )
    entry: Dict[str, Any] = {"enabled": body.enabled, "launch": history}
    for key in ("priority", "max_retries", "retry_interval_seconds"):
        value = getattr(body, key)
        if value is not None:
            entry[key] = value
    await _call(service.set_autostart, entry)
    return {"model_uid": model_uid, "enabled": body.enabled}


def _launch_history(model_uid: str) -> Optional[Dict[str, Any]]:
    rows = service.get("/v1/launch_history") or []
    if isinstance(rows, dict):
        rows = rows.get("data") or rows.get("items") or []
    best = None
    for row in rows:
        if row.get("model_uid") == model_uid or row.get("model_name") == model_uid:
            best = row  # 取最后一条 = 最近一次用的参数
    return (best or {}).get("data") if best else None


@route_inference.delete("/models/{model_uid}/autostart", summary="取消自启动")
async def clear_autostart(model_uid: str) -> Dict[str, Any]:
    await _call(service.clear_autostart, model_uid)
    return {"model_uid": model_uid, "enabled": False}


@route_inference.put("/bindings/{role}", summary="把某个角色绑到指定模型上")
async def put_binding(
    role: str,
    body: BindingBody,
    db: AsyncSession = Depends(get_relation_db),
    current_user=Depends(get_admin_user),
) -> Dict[str, Any]:
    if role not in bindings.ROLES:
        raise HTTPException(status_code=422, detail=f"未知的推理角色：{role}")

    if role == "embedding":
        conflict = await _embedding_guard(db, body.model_uid)
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict)

    # 记下是谁改的：换模型会让所有回答的口径变掉，出问题时第一个要问的就是这个
    await bindings.set_binding(
        db, role, body.model_uid, body.model_name or body.model_uid, user_id=current_user.id
    )
    # 换完立刻把新值回给界面：省一次往返，也让「界面显示的就是库里的」这件事可断言
    return bindings.snapshot()


async def _embedding_guard(db: AsyncSession, model_uid: str) -> Optional[str]:
    """换 embedding 模型 = 已索引集合全部作废。这里只在**真的会坏东西**时拦。

    维度从服务器读（实测 `/v1/models/embedding/{name}/versions` 带 `dimensions`），
    不要求人手填 —— 那个 `EMBEDDING_DIMENSION` 键本来就是「有人读、没人写」的候选。
    """
    indexed = await db.scalar(select(func.count()).select_from(Document))
    if not indexed:
        return None  # 库里一篇都没有，谈不上失效
    try:
        dims = await _call(service.embedding_dimensions, model_uid)
    except Exception:  # noqa: BLE001 读不到维度时放行但说明原因，别把用户锁死
        return None
    if dims and dims != embedding_dimension:
        return (
            f"目标 embedding 模型的维度是 {dims}，而现有索引建在 {embedding_dimension} 维上。"
            f"换过去之后 {indexed} 篇文档的向量全部失效，而重建需要原文"
            "（本机现状：已入库文档的原文已丢失，见交接文档 §5.0）。"
            "先重传原文并重建索引，再回来换绑定。"
        )
    return None


@route_inference.post(
    "/auth/refresh",
    summary="重签 xinference 凭据（服务器重置口令之后用）。改 .env 里的地址/账号/口令要重启后端",
)
async def relogin() -> Dict[str, Any]:
    # 「改完 .env 就用」这句以前写在 summary 里，而它做不到：`auth.py` 在 import 时
    # 就把 xinference_addr / 用户 / 口令绑成了模块级常量，重签用的还是旧值。
    # 现在把这句话改成它实际做的事 —— 界面承诺做不到的事，比不承诺更坏。
    auth.reset()
    await _call(auth.bearer, True)
    return auth.state()
