#!/usr/bin/env python
"""建（或提权）第一个管理员账号。

为什么需要它：自助注册拿不到管理员。`UserService.create_user` 把 `role_id` 写死成 1
（= 最小权限的 `user`），注册 DTO 里也没有 role 通道 —— 这是对的（否则任何人都能自封 admin），
但它留下一个空洞：**全新部署里没有任何一条路能产出第一个 role_id=3 的账号**。
而 `/admin/*`、知识库的创建、模型加载面板全都要求 admin，于是新装的系统一打开就锁死。
以前只能手写 SQL；手改 `role_id` 还有一个坑：不改 `token_version` 的话旧令牌继续按新角色生效。

账号已存在时这条命令变成「提权」，并且自增 `token_version`（身份相关字段变了 = 旧会话不再可信，
与应用自己的规则一致）。

用法：
    apps/backend/.venv/bin/python scripts/create_admin.py --name ametrine
        # 不给 --password 就交互式输入（不回显、不写进 shell 历史）
    apps/backend/.venv/bin/python scripts/create_admin.py --name ops --email ops@corp.local --role manager
    apps/backend/.venv/bin/python scripts/create_admin.py --name ametrine --role user
        # 已存在就降级为普通成员
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "backend"))

from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

ROLES = ("admin", "manager", "user")
MIN_PASSWORD = 8


def read_password(arg: str | None, name: str) -> str:
    if arg:
        password = arg
    else:
        password = getpass.getpass(f"给 {name} 设的口令（≥{MIN_PASSWORD} 位，输入不回显）：")
        if password != getpass.getpass("再输一次确认："):
            sys.exit("两次输入不一致，已停止。")
    if len(password) < MIN_PASSWORD:
        sys.exit(
            f"口令只有 {len(password)} 位，要求 ≥{MIN_PASSWORD}。"
            "这个账号能建知识库、能加载模型、能看所有人的对话反馈，别用最简单的。"
        )
    return password


async def run(name: str, email: str | None, password: str, role: str) -> int:
    from src.client import async_session
    from src.models import Role, User
    from src.utils.security import hash as hash_password

    async with async_session() as session:
        role_id = (
            await session.execute(select(Role.id).where(Role.name == role))
        ).scalar()
        if role_id is None:
            print(
                f"✗ 库里没有名为 `{role}` 的角色行 —— `role` 表是空的。\n"
                "  先跑：apps/backend/.venv/bin/python scripts/init_db.py"
            )
            return 1

        user = (
            await session.execute(select(User).where(User.name == name))
        ).scalar_one_or_none()

        if user:
            if password:
                user.password = hash_password(password)
            changed_role = user.role_id != role_id
            if changed_role:
                user.role_id = role_id
            if email:
                user.email = email
            if changed_role:
                # 与应用自己的规则一致：权限字段变了就吊销已有会话
                user.token_version = (user.token_version or 0) + 1
            if not (password or changed_role or email):
                print(f"· {name} 已经是 {role}（id={user.id}），无需改动")
                return 0
            await session.commit()
            print(
                f"✓ {name}（id={user.id}）："
                + "、".join(
                    part
                    for part in (
                        f"角色改为 {role}（token_version → {user.token_version}，他的旧令牌当场失效）"
                        if changed_role
                        else None,
                        "口令已更新" if password else None,
                        f"邮箱 {email}" if email else None,
                    )
                    if part
                )
            )
            return 0

        if not password:
            sys.exit("新建账号必须给口令：--password 或按提示输入。")
        new = User(
            name=name,
            email=email,
            password=hash_password(password),
            role_id=role_id,
            is_active=True,
            token_version=0,
        )
        session.add(new)
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            print(
                f"✗ 写入失败：{type(exc.orig).__name__}\n"
                "  多半是同名账号或同一个 email 已存在（两列都有 unique 约束）。"
            )
            return 1
        await session.refresh(new)
        print(f"✓ 已创建 {role} 账号：{name}（id={new.id}）")
        print("  用这个账号登录 Web 界面，/admin/* 与模型加载面板就都开了。")
        return 0


async def action(args) -> int:
    """整个流程跑在**一个**事件循环里。

    分两次 `asyncio.run()` 是实测炸过的：asyncpg 的连接池绑定在建立它的那个循环上，
    第一次循环里探存在性、第二次循环里写库，就会得到
    `RuntimeError: got Future <Future pending> attached to a different loop`。
    """
    from src.client import async_session

    async with async_session() as s:
        existing = bool(
            (
                await s.execute(
                    text('select 1 from "user" where name = :n'), {"n": args.name}
                )
            ).scalar()
        )
    # 已存在 + --keep-password 才跳过问口令；新建账号没有口令就没有意义
    password = "" if (existing and args.keep_password) else read_password(
        args.password, args.name
    )
    return await run(args.name, args.email, password, args.role)


def main() -> int:
    ap = argparse.ArgumentParser(description="创建或提权第一个管理员账号")
    ap.add_argument("--name", required=True, help="登录名（1-30 字符）")
    ap.add_argument("--email", default=None, help="可选；也可用邮箱登录")
    ap.add_argument("--password", default=None, help="不给则交互式输入（不回显）")
    ap.add_argument(
        "--role",
        choices=ROLES,
        default="admin",
        help="默认 admin：新部署只有它才能继续往下配",
    )
    ap.add_argument(
        "--keep-password",
        action="store_true",
        help="账号已存在时不改口令，只改角色/邮箱（不给这个选项会提示输入新口令）",
    )
    args = ap.parse_args()

    if not 1 <= len(args.name) <= 30:
        sys.exit("登录名长度要在 1-30 之间（user.name 的列宽）")
    return asyncio.run(action(args))


if __name__ == "__main__":
    sys.exit(main())
