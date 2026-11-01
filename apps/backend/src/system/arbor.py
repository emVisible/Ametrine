"""Arborist 状态契约：`GET /api/arbor/status`。

中控台要的是「这台部署现在到底能不能用」，而 `/health` 回答的是「进程活着吗」：
前者要说清是哪个依赖不行，并且任何依赖不行时都得有一个应答，所以这条单独存在。

两处形状上的硬要求，破了都不会报错、只会静默失效：

1. 响应必须是**裸 JSON**。本应用的默认响应类 `IResponse` 会把任何 dict 包进
   `{code, message, data}`，那样中控台读不到顶层 `state`，于是降级成端口探测 ——
   灯照样绿，契约等于没实现。所以这里显式指定 `response_class=JSONResponse`。
2. 不能走 `Depends(get_redis)`：那个依赖在 Redis 连不上时**自己抛异常**，
   而依赖解析在路由之前，抛出来就是 500 信封。契约要的恰恰是「Redis 挂了也要
   说它挂了」，所以三个检查都在函数体内自己做，各自吞掉异常只回报真假。
"""

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pymilvus import MilvusClient
from redis import Redis
from sqlalchemy import text

from src.client import async_session
from src.config import (
    milvus_host,
    milvus_port,
    redis_db,
    redis_host,
    redis_password,
    redis_port,
)
from src.middleware.tags import ControllerTag
from src.version import APP_VERSION

route_arbor = APIRouter(tags=[ControllerTag.arbor])

# 单条检查的天花板：依赖不在时这条路由要快速回话，不能把中控台的轮询拖成负载源。
_TIMEOUT = 2.0


async def _postgres_ok() -> bool:
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 契约只回报真假，细节留在登录后的概览页
        return False


def _redis_ok() -> bool:
    client = Redis(
        host=redis_host,
        port=redis_port,
        db=redis_db,
        password=redis_password or None,
        decode_responses=True,
        socket_connect_timeout=_TIMEOUT,
        socket_timeout=_TIMEOUT,
    )
    try:
        return bool(client.ping())
    except Exception:  # noqa: BLE001
        return False
    finally:
        client.close()


def _milvus_ok() -> bool:
    try:
        MilvusClient(host=milvus_host, port=milvus_port, timeout=_TIMEOUT).list_databases()
        return True
    except Exception:  # noqa: BLE001
        return False


async def _guarded(coro) -> bool:
    try:
        return await asyncio.wait_for(coro, _TIMEOUT)
    except Exception:  # noqa: BLE001 超时与连不上在契约里是同一件事：它不回话
        return False


def _verdict(services: dict) -> tuple:
    """依赖真假 → 契约状态。postgres 不在是「不可用」，其余不在只是「有异常」。"""
    bad = [name for name, ok in services.items() if not ok]
    if not services["postgres"]:
        return "error", f"v{APP_VERSION} · 关系库不可用"
    if bad:
        return "degraded", f"v{APP_VERSION} · {'/'.join(bad)} 不可用"
    return "ok", f"v{APP_VERSION} · 依赖全部正常"


@route_arbor.get("/arbor/status", response_class=JSONResponse)
async def arbor_status():
    postgres = await _guarded(_postgres_ok())
    redis_ok, milvus_ok = await asyncio.gather(
        _guarded(asyncio.to_thread(_redis_ok)),
        _guarded(asyncio.to_thread(_milvus_ok)),
    )
    state, line = _verdict({"postgres": postgres, "redis": redis_ok, "milvus": milvus_ok})
    return JSONResponse({"state": state, "line": line})
