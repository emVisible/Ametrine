#!/usr/bin/env python
"""把一个**空**的 PostgreSQL 库 bootstrap 成能用的状态。

为什么需要这个脚本（三条都是实测出来的，不是猜想）：

1. `alembic upgrade head` 在空库上跑不通。最早的迁移 183b1de5387e 只有 ALTER：
   它 `add_column("user", …)`，而那张 `user` 表得先存在 —— 现有迁移里没有一条能建出第一张表。
2. 应用的 lifespan 会跑 `Base.metadata.create_all()`，所以「先启起来」确实能建出表，
   但它**不写 `alembic_version`**：表有了、迁移历史是空的，于是下一次 `upgrade head`
   会把那些 ALTER 从头再跑一遍，撞在「列已存在」上。
3. `create_all()` 也**不播种 `role` 行**，而 `user.role_id` 上有指向 `role(id)` 的外键
   （实测本机库：`user_role_id_fkey FOREIGN KEY (role_id) REFERENCES role(id)`）。
   播种只写在迁移 183b1de5387e 里（1=user、2=manager、3=admin），走 create_all 这条路正好跳过它。
   结果：空库上**注册第一个账号**会得到一条外键违反，而报错一个字都不提 `role` 表。

所以正确顺序是 create_all → 播种 role → stamp head，而这三步原来一步都没有。

用法：
    apps/backend/.venv/bin/python scripts/init_db.py
        # 建表 + 播种角色 + 记下迁移版本（幂等，可反复跑）
    apps/backend/.venv/bin/python scripts/init_db.py --create-database
        # 顺带把 POSTGRE_ADDR 里那个库名 CREATE DATABASE 出来（需要账号有 CREATEDB 权限）
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "apps" / "backend"
sys.path.insert(0, str(BACKEND))

from sqlalchemy import inspect, make_url, text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

ROLES = [(1, "user"), (2, "manager"), (3, "admin")]
HEAD = "c7e2a58f1b34"
# CREATE DATABASE 不接受绑定参数，库名只能白名单校验之后再拼进语句（PG 也没有 IF NOT EXISTS）
_DB_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


async def create_database(dsn: str) -> None:
    """库不存在就把它建出来：连到维护库 `postgres` 去建，建完就断开。"""
    url = make_url(dsn)
    name = url.database
    if not name or not _DB_NAME.match(name):
        sys.exit(
            f"POSTGRE_ADDR 的库名 `{name}` 不是可以自动创建的标识符"
            "（只允许字母/数字/下划线，且必须以字母或下划线开头）。\n"
            f"请自己建库：createdb -U <user> {name}"
        )
    engine = create_async_engine(
        url.set(database="postgres").render_as_string(hide_password=False),
        isolation_level="AUTOCOMMIT",
    )
    try:
        async with engine.connect() as conn:
            exists = (
                await conn.execute(
                    text("select 1 from pg_database where datname = :n"), {"n": name}
                )
            ).scalar()
            if exists:
                print("  · 数据库已存在，跳过创建")
            else:
                await conn.execute(text(f'CREATE DATABASE "{name}"'))
                print(f"  · 已创建数据库 `{name}`")
    finally:
        await engine.dispose()


async def apply_schema(dsn: str) -> dict:
    """建表 + 播种角色，并读出当前迁移版本（stamp 要在事件循环之外做）。"""
    from src import models  # noqa: F401  导入即把全部表注册到 Base.metadata
    from src.client import Base

    engine = create_async_engine(dsn)
    try:
        async with engine.begin() as conn:
            tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
            if tables:
                print(f"  · 已有 {len(tables)} 张表，create_all 只补缺失的那几张")
            else:
                print("  · 空库：按模型建表")
            await conn.run_sync(Base.metadata.create_all)

            seeded = 0
            for role_id, role_name in ROLES:
                done = (
                    await conn.execute(
                        text('select 1 from "role" where id = :i'), {"i": role_id}
                    )
                ).scalar()
                if done:
                    continue
                await conn.execute(
                    text(
                        'INSERT INTO "role" (id, name) VALUES (:i, :n) '
                        "ON CONFLICT (id) DO NOTHING"
                    ),
                    {"i": role_id, "n": role_name},
                )
                seeded += 1
            if seeded:
                print(f"  · 播种角色 {seeded} 个（user / manager / admin）")

            version = None
            has_version = await conn.run_sync(
                lambda c: inspect(c).has_table("alembic_version")
            )
            if has_version:
                version = (
                    await conn.execute(text("select version_num from alembic_version"))
                ).scalar()
            return {"tables": len(tables), "seeded": seeded, "version": version}
    finally:
        await engine.dispose()


def stamp_head() -> None:
    """把现有迁移记成「已应用」—— create_all 建的表已经是最终形状，那些 ALTER 不必也不能再跑。"""
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    command.stamp(cfg, "head")


def main() -> int:
    ap = argparse.ArgumentParser(description="空库 bootstrap：建表 + 播种角色 + stamp 迁移版本")
    ap.add_argument(
        "--create-database",
        action="store_true",
        help="库不存在时 CREATE DATABASE（需要账号有 CREATEDB 权限）",
    )
    args = ap.parse_args()

    from src.config import postgre_addr

    print("目标库：", make_url(postgre_addr).render_as_string(hide_password=True))
    if args.create_database:
        asyncio.run(create_database(postgre_addr))
    info = asyncio.run(apply_schema(postgre_addr))

    current = info["version"]
    if current is None:
        stamp_head()
        print(f"  · 已 stamp 到 head（{HEAD}）")
    elif current != HEAD:
        print(
            f"  ✗ 这个库的迁移停在 {current}，不是 head {HEAD}。\n"
            "    这里**不**替你 stamp —— 那会把没跑过的迁移谎报成跑过。\n"
            "    该跑的是：cd apps/backend && .venv/bin/alembic upgrade head"
        )
        return 1
    else:
        print(f"  · 迁移版本已在 head（{HEAD}）")

    print(
        "\n✓ 完成。下一步建第一个管理员：\n"
        "    apps/backend/.venv/bin/python scripts/create_admin.py --name <账号名>"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
