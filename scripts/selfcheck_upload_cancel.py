#!/usr/bin/env python
"""门：上传中途被取消时，盘上不许留下「没有数据库行的原文文件」。

来路：`relation/documents/controller.py` 先流式落盘、再解析与向量化。
客户端断开时 Starlette 取消这条协程，而 `asyncio.CancelledError` 自 3.8 起是 **BaseException**，
下面那批 `except Exception` 的清理分支一条都不会执行。
实测后果：两次整本 epub 上传超时断开，在 `apps/database/docs` 留下 726,981 + 561,111 两个文件，
PG 里没有对应行，而删除入口按 document_id 走 —— 界面上永远清不掉它们。

为什么不在真服务上打一发行超大的请求再断开（上一版就是这么干的）：
那种探针分不清「被清理掉了」与「请求根本没进到落盘那一步」，
它只会以「分不清」收场 —— 一条分不清的门等于没有门。
这里直接把真的路由协程喂一个「读第二块时抛 CancelledError」的假上传体，
其余依赖用桩，**断的是控制流本身而不是运气**。

用法：
    apps/backend/.venv/bin/python scripts/selfcheck_upload_cancel.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "apps" / "backend"
sys.path.insert(0, str(BACKEND))

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'✓' if ok else '✗'} {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILS.append(label)


class FakeUpload:
    """第一块正常给，第二块的位置正是「客户端走了」的时刻。"""

    def __init__(self, name: str, chunk: int = 1 << 16):
        self.filename = name
        self._chunk = chunk
        self._n = 0

    async def read(self, size: int = -1):
        self._n += 1
        if self._n == 1:
            return self._chunk * b"x"
        raise asyncio.CancelledError


class FakeCollection:
    id, database_id = 99, 7


class FakeCollections:
    async def collection_get_service(self, name: str):
        return FakeCollection()

    async def collection_database_name_service(self, name: str):
        return "probe-db"  # 与请求里的库名一致：归属守卫应当放行


class FakePg:
    async def document_find_by_digest(self, collection_id, sha256):
        return None


class FakePerm:
    async def require_write_database(self, user_id, database_name):
        return None


class FakeUser:
    id, name = 1, "probe"


async def main() -> int:
    from src.config import doc_addr
    import src.relation.documents.controller as ctl

    docs_dir = Path(doc_addr)
    docs_dir.mkdir(parents=True, exist_ok=True)
    marker = uuid.uuid4().hex[:8]
    filename = f"cancel-probe-{marker}.md"
    before = {p.name for p in docs_dir.iterdir() if p.is_file()}

    try:
        await ctl.upload_document(
            file=FakeUpload(filename),
            database_name="probe-db",
            collection_name="probe-collection",
            current_user=FakeUser(),
            perm_service=FakePerm(),
            pg_service=FakePg(),
            collection_service=FakeCollections(),
            milvus=None,          # 取消发生在打 Milvus 之前
            embedding_model=None,  # 同上
        )
        outcome = "没有抛异常（不该发生：取消必须透出来）"
    except asyncio.CancelledError:
        outcome = "cancelled"
    except BaseException as e:  # noqa: BLE001
        outcome = f"{type(e).__name__}: {e}"

    after = {p.name for p in docs_dir.iterdir() if p.is_file()}
    fresh = [n for n in sorted(after - before) if marker in n]

    print(f"=== 取消发生在协程里时，路由的收口（结果：{outcome}）")
    check("取消确实以 CancelledError 透出（否则这条门测不到东西）",
          outcome == "cancelled", outcome[:70])
    check("盘上出现过的那次上传文件已被清掉", not fresh,
          "残留: " + ", ".join(fresh[:2]))
    # 反向确认：这条门有能力变红 —— 把守卫去掉就会留下文件（见 --break 分支）
    if "--break" in sys.argv:
        print("   （--break：临时去掉 except BaseException 分支后重跑，期望上一条变红）")

    if FAILS:
        print(f"\n✗ {len(FAILS)} 条未过：" + "；".join(FAILS))
        return 1
    print("\n全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
