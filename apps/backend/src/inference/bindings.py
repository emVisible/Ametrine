"""角色 → 模型 的绑定。

这是本系统唯一真正新增的推理配置数据。设计约束（见
`docs/DESIGN-2026-09-30-inference-model-management.md`）：

* 只存**指向关系**。模型清单、运行状态、显存、launch 参数、向量维度全部由 xinference
  的 API 现算，抄一份进库就是第二个事实源 —— `user.*_token_used` 那三个死列
  （有人读、没人写）就是这么来的。
* **同步路径只读内存**。`get_llm_model()` 这类 getter 是同步的、每条请求都要走，
  不能在那里等数据库；所以真值在 `refresh()` 时灌进 `_snapshot`，同步侧零 IO。
* 改绑定必须让句柄缓存失效。`get_rerank_model()` / `get_embedding_model()` 以前带
  `@lru_cache`，换完绑定不清缓存 = 界面显示已换、请求还在用旧句柄 ——
  和昨晚修掉的 `crossBase` 依赖数组是同一类「界面撒谎」。
  失效函数由 `src/client.py` 注册进来（`register_invalidator`），
  而不是让每个调用点自己记得清 —— 那会变成「谁记得谁负责」。
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import (
    xinference_embedding_model_id,
    xinference_llm_model_id,
    xinference_rerank_model_id,
)


def _model():
    """ORM 类延迟导入。

    模块级 `from src.models import ...` 会形成导入环：
    `src.client` → 本模块 → `src.models` → `src.client`（而 `Base` 要到
    `src/client.py:40` 才存在），结果是应用起不来却报一句看不懂的 ImportError。
    """
    from src.models import InferenceRoleBinding  # noqa: PLC0415

    return InferenceRoleBinding

ROLES: tuple[str, ...] = ("llm", "embedding", "rerank")

# 快照多久算旧。
#
# 为什么需要：快照是**进程内**的，而改绑定只会让**自己这个进程**失效。
# 多 worker 部署（uvicorn --workers N）下，A 进程写了新绑定，B 进程的快照还是旧的 ——
# 那就是「界面显示已换、部分请求仍走旧模型」，和 crossBase 那条同一类。
# 读侧带一个很短的 TTL，超过就去库里重新灌一次；同步 getter 依然零 IO。
STALE_AFTER_SECONDS = 30.0

# 表里还没数据时的兜底。刻意保留：老部署只改了 .env 也能跑起来，
# 但一旦管理台写过绑定，这里就再也不参与（见 _fallback_for 的调用条件）。
_SETTINGS_FALLBACK: Dict[str, str] = {
    "llm": xinference_llm_model_id,
    "embedding": xinference_embedding_model_id,
    "rerank": xinference_rerank_model_id,
}

_lock = threading.Lock()
_snapshot: Dict[str, str] = {}          # role -> model_uid
_names: Dict[str, str] = {}             # role -> model_name（只为显示）
_seeded = False                          # 本轮进程里是否已经确认过表非空
_loaded_at = 0.0                         # 上次灌快照的单调时刻，给 stale() 用
_invalidators: List[Callable[[], None]] = []


def register_invalidator(fn: Callable[[], None]) -> None:
    """让 `src/client.py` 把自己的缓存清理挂上来（避免模块级循环 import）。"""
    with _lock:
        if fn not in _invalidators:
            _invalidators.append(fn)


def _fire_invalidators() -> None:
    with _lock:
        fns = list(_invalidators)
    for fn in fns:
        fn()


def current(role: str) -> str:
    """同步读当前绑定的 model_uid。

    没 refresh 过（进程刚起、或表读失败）时回落到 .env 的值 ——
    这是兼容路径，不是第二事实源：界面上的绑定一律以 `snapshot()` 为准。
    """
    with _lock:
        uid = _snapshot.get(role)
    if uid:
        return uid
    if role in _SETTINGS_FALLBACK:
        return _SETTINGS_FALLBACK[role]
    raise KeyError(f"未知的推理角色：{role}")


def snapshot() -> Dict[str, Any]:
    """给界面/就绪面板看的完整视图，并说明每个值是从哪来的。"""
    with _lock:
        rows = dict(_snapshot)
        names = dict(_names)
    return {
        "roles": [
            {
                "role": role,
                "model_uid": rows.get(role) or _SETTINGS_FALLBACK.get(role, ""),
                # 显示名可能为空（表里只存了 uid）；界面自己按 uid 去运行清单里找名字。
                "model_name": names.get(role, ""),
                # from_settings 是**诚实标记**：老 .env 兜底时界面要能显示「来自 .env」，
                # 而不是让人以为已经在管理台配过了。
                "from_settings": role not in rows,
            }
            for role in ROLES
        ]
    }


async def refresh(session: AsyncSession) -> Dict[str, str]:
    """把表读进内存快照。调用方负责在启动时和每次改绑定后调它。

    ⚠ `global` 一个都不能少：第一版这里只声明了 `_seeded, _loaded_at`，
    于是 `_snapshot = {...}` 写的是**局部变量**，模块级快照永远是空的，
    `current()` 静默回落到 .env —— 表现就是「管理台改了绑定、当次进程完全不生效」，
    而且因为回落看起来是好的，没有任何一条报错。是自检第 2 条把它抓出来的
    （`set_binding` 返回了 `{}`，而 DB 行确实已经改了）。
    """
    global _snapshot, _names, _seeded, _loaded_at
    rows = (await session.execute(select(_model()))).scalars().all()
    with _lock:
        _snapshot = {r.role: r.model_uid for r in rows}
        _names = {r.role: (r.model_name or "") for r in rows}
        _seeded = bool(rows)
        _loaded_at = time.monotonic()
    return dict(_snapshot)


def stale() -> bool:
    """快照是否该重读了。从没读过（`_loaded_at == 0`）也算旧。"""
    with _lock:
        if not _loaded_at:
            return True
        return (time.monotonic() - _loaded_at) > STALE_AFTER_SECONDS


async def bootstrap(session: AsyncSession) -> Dict[str, Any]:
    """表为空时用 .env 的三个 id 播种，让管理台第一次打开就有东西可看。

    播种而不是「虚拟显示」：不写进去的话，第一次 `PUT /bindings/{role}` 之前
    表是空的，界面就得靠猜；而猜出来的行正是「看起来有、其实没有」那类缺陷的温床。
    """
    existing = (await session.execute(select(_model().role))).scalars().all()
    if not set(existing) >= set(ROLES):
        model = _model()
        for role in ROLES:
            uid = _SETTINGS_FALLBACK.get(role) or ""
            if role in existing or not uid:
                continue
            session.add(model(role=role, model_uid=uid, model_name=uid))
        await session.commit()
    return await refresh(session)


async def set_binding(
    session: AsyncSession,
    role: str,
    model_uid: str,
    model_name: str = "",
    user_id: Optional[int] = None,
) -> Dict[str, str]:
    """写一条绑定，并**在这里**把缓存失效掉。

    失效放在写函数内部而不是路由里，是因为漏掉它的后果（界面显示新模型、
    实际还在用旧句柄）比多调一次的成本大得多。
    """
    if role not in ROLES:
        raise ValueError(f"未知的推理角色：{role}")
    model = _model()
    row = await session.get(model, role)
    if row is None:
        session.add(
            model(
                role=role, model_uid=model_uid, model_name=model_name, updated_by=user_id
            )
        )
    else:
        row.model_uid = model_uid
        row.model_name = model_name
        row.updated_by = user_id
    await session.commit()
    await refresh(session)
    _fire_invalidators()
    return dict(_snapshot)


async def refresh_if_changed(session: AsyncSession) -> Dict[str, str]:
    """快照旧了就重读一次；**只有真的变了**才失效句柄缓存。返回变化项（空 = 没变）。

    为什么变化判定和失效放在一起：和 `set_binding` 同一个理由 —— 漏掉失效的后果
    （界面显示新模型、请求还在用旧句柄，而且 `get_splitter()` 的 lru_cache 里还藏着
    上一个 embedding 模型）比多调一次的成本大得多，所以不能让每个调用方自己记得。

    这个函数存在的另一个理由是兑现上面那段注释：`STALE_AFTER_SECONDS` 写好了，
    可此前只有两个管理端 GET 在问 `stale()`，同步读的 `current()` 从来不看它 ——
    多 worker 下第二个 worker 的快照实际上永远不过期。定期调用它的是
    `main.py` 的后台任务（同步 getter 仍然零 IO）。
    """
    if not stale():
        return {}
    with _lock:
        before = dict(_snapshot)
    await refresh(session)
    with _lock:
        after = dict(_snapshot)
    changed = {role: uid for role, uid in after.items() if before.get(role) != uid}
    changed.update({role: "(已解绑)" for role in before if role not in after})
    if changed:
        _fire_invalidators()
    return changed


def seeded() -> bool:
    with _lock:
        return _seeded
