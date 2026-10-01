#!/usr/bin/env python
"""部署前/部署后的**只读**体检：一条命令回答「这套东西在这台机器上装得起来吗」。

为什么需要它：这一轮实测里最贵的教训不是某个 bug，而是**能力缺口只在用户上传的那一刻才暴露**。
`.pdf`/`.doc`/`.epub` 在这台机器上是 501；`uv.lock` 里没有 `unstructured` 的 extras（于是
一次全新 `uv sync` 会把已经能用的解析能力再削掉一半）；启动链脚本有六个还没进版本库
（新克隆的机器 `dev.sh` 直接跑不动）—— 这些全都能在启动之前一次查清，而不是等用户撞到。

它什么都不改：不装包、不写库、不建集合。所有破坏性动作只**报告**。

用法：
    apps/backend/.venv/bin/python scripts/doctor.py            # 常规体检（快）
    apps/backend/.venv/bin/python scripts/doctor.py --live      # 再加推理活性探测（慢 5-60s）
    apps/backend/.venv/bin/python scripts/doctor.py --json -v  # 机器可读、含 OK 行

退出码：0 = 没有 FAIL（WARN 不影响结论）；1 = 至少一条 FAIL。
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "apps" / "backend"
sys.path.insert(0, str(BACKEND))

# 本机 127.0.0.1 上的服务绝不能走代理：这台机器一旦有 HTTP_PROXY，
# httpx/requests 会连 localhost 一起交给代理，代理替它回一个 502 的 HTML，
# 于是「服务明明是好的」被读成「服务挂了」。这一轮已经栽过一次。
os.environ["NO_PROXY"] = os.environ.get("NO_PROXY", "") + ",localhost,127.0.0.1"


class Row:
    def __init__(self, area: str, label: str, level: str, detail: str = "", fix: str = ""):
        self.area, self.label, self.level = area, label, level
        self.detail, self.fix = detail, fix or ""

    def as_dict(self) -> dict:
        return {"area": self.area, "label": self.label, "level": self.level,
                "detail": self.detail, "fix": self.fix}


ROWS: list[Row] = []


def add(area: str, label: str, ok: bool | None, detail: str = "", fix: str = "") -> None:
    """ok=True 通过 / False 拦路（FAIL）/ None 提醒（WARN）。"""
    level = "OK" if ok is True else ("FAIL" if ok is False else "WARN")
    ROWS.append(Row(area, label, level, str(detail), fix))


def guard(area: str, label: str, fn) -> None:
    """任何一条检查炸了都变成一行 FAIL，而不是把整份报告带倒。"""
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        add(area, label, False, f"{type(exc).__name__}: {str(exc).splitlines()[0][:160]}")


# ══════════════════════════════════════════════════════════════
# 1. 配置
# ══════════════════════════════════════════════════════════════
def check_config(settings) -> None:
    area = "配置"
    add(area, "Settings 已加载（含 SECRET_KEY 强度闸门）", True,
        f"{len(type(settings).model_fields)} 个字段")
    add(area, "DOC_ADDR 绝对且可写",
        os.path.isabs(settings.doc_addr) and os.access(settings.doc_addr, os.W_OK | os.X_OK),
        settings.doc_addr, "改成这个进程可写的绝对路径")
    add(area, "CORS_ORIGINS 非空", bool(settings.cors_origins), settings.cors_origins,
        "把前端实际来源加进 CORS_ORIGINS（默认只有 vite 的 8000）")
    ok_dsn = "://" in settings.postgre_addr and "asyncpg" in settings.postgre_addr
    add(area, "POSTGRE_ADDR 是 asyncpg DSN", ok_dsn,
        settings.postgre_addr.split("@")[-1] if ok_dsn else settings.postgre_addr,
        "形如 postgresql+asyncpg://user:pw@host:5432/dbname")
    add(area, "Redis 走配置而不是写死", True,
        f"{settings.redis_host}:{settings.redis_port} db={settings.redis_db} "
        f"password={'已设' if settings.redis_password else '未设'}")
    if not settings.redis_password:
        add(area, "Redis 没有口令", None, f"{settings.redis_host}:{settings.redis_port}",
            "compose 起的 Redis 默认无密码且监听 0.0.0.0：非本机部署要加 requirepass 并填 REDIS_PASSWORD")
    tok = settings.tokenizer_addr
    # 「像不像路径」不能只看有没有斜杠：`Qwen/Qwen2.5-3B-Instruct` 也是 hub id（本机就是这一个）。
    # 真正的判据是它以 / ~ / ./ 开头，或者本来就是存在的目录。
    looks_like_path = tok.startswith(("/", "./", "../", "~/")) or Path(tok).is_dir()
    if looks_like_path:
        p = Path(tok).expanduser()
        add(area, "TOKENIZER_ADDR 指向的目录存在", p.is_dir(), str(p),
            "填了绝对路径但目录不存在时，HuggingFace 只抛一句不提这个键的 HFValidationError")
    else:
        add(area, "TOKENIZER_ADDR 是 hub id（首次要联网）", None, tok,
            "离线机器：提前把 tokenizer 目录放到本地，并把 TOKENIZER_ADDR 改成那个绝对路径")
    add(area, "SEMANTIC_SPLITTER", None, str(settings.semantic_splitter),
        "开着时每个句子都要过一次 embedding：整本书记得住的文档会变成 501/超时以外的第三种失败"
        "（实测一本 .epub 在这条路上 >900s 未入库）。批量入库的书建议先关")


# ══════════════════════════════════════════════════════════════
# 2. 解析能力（逐扩展名）
# ══════════════════════════════════════════════════════════════
# import 名 → 发布名（声明与 lock 检查要用发布名）
DIST = {
    "bs4": "beautifulsoup4",
    "docx": "python-docx",
    "msoffcrypto": "msoffcrypto-tool",
    "odf": "odfpy",
    "pptx": "python-pptx",
    "pypandoc": "pypandoc",
    "unstructured_inference": "unstructured-inference",
}
# 每一项都对应这一轮**实测到**的失败点，不是猜的：
# .doc/.ppt 要 LibreOffice；.epub/.odt 要 pandoc；.pdf 要 unstructured-inference>=1.6.10
# （锁在 1.1.1 时缺 inference.pdf_image 模块，实测 501）。
PARSERS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    ".txt": ((), ()),
    ".md": ((), ()),
    ".markdown": ((), ()),
    ".csv": (("unstructured.partition.csv",), ()),
    ".html": (("unstructured.partition.html", "bs4", "lxml"), ()),
    ".eml": (("unstructured.partition.email",), ()),
    ".docx": (("unstructured.partition.docx", "docx"), ()),
    ".pptx": (("unstructured.partition.pptx", "pptx"), ()),
    ".xlsx": (("unstructured.partition.xlsx", "openpyxl", "msoffcrypto"), ()),
    ".odt": (("unstructured.partition.odt", "odf", "pypandoc"), ("pandoc",)),
    ".epub": (("unstructured.partition.epub", "ebooklib", "pypandoc"), ("pandoc",)),
    ".pdf": (("unstructured.partition.pdf", "unstructured_inference.inference.pdf_image",
              "layoutparser", "onnxruntime"), ()),
    ".doc": (("unstructured.partition.doc",), ("soffice",)),
    ".ppt": (("unstructured.partition.ppt",), ("soffice",)),
}


def can_import(mod: str) -> bool:
    try:
        importlib.import_module(mod)
        return True
    except Exception:  # noqa: BLE001 —— ImportError/OSError/子模块导入期任意异常都算不可用
        return False


def _lock_unstructured_extras(lock: str) -> set[str]:
    """逐行取 lock 里 unstructured 那条依赖声明上的 extras。

    不用跨行正则：`.*?extras = [` 在 re.S 下能一路匹到几百行之后别人的 extras，
    于是把「lock 里根本没有」读成「lock 里有」—— 这种假绿比没查更糟。
    """
    found: set[str] = set()
    for line in lock.splitlines():
        if 'name = "unstructured"' in line:
            m = re.search(r'extras = \[([^\]]*)\]', line)
            if m:
                found |= set(re.findall(r'"([a-z]+)"', m.group(1)))
    return found


def display_for(mod: str) -> str:
    """import 名 → 部署者该敲进 requirements 的发布名。

    `unstructured.partition.pdf` 的失败其实意味着 `unstructured[pdf]` 这条链不完整
    （它会把 unstructured-inference/layoutparser/onnxruntime 一起带进来），
    报成「缺 unstructured」是把人往错的方向推。
    """
    if mod.startswith("unstructured.partition."):
        return f"unstructured[{mod.rsplit('.', 1)[-1]}]"
    if mod.startswith("unstructured_inference"):
        return "unstructured-inference>=1.6.10"
    return DIST.get(mod.split(".")[0], mod.split(".")[0])


def check_parsers() -> None:
    area = "解析能力"
    from src.vector.documents.loader import LOADER_MAPPING

    pp = (BACKEND / "pyproject.toml").read_text(encoding="utf8")
    lock_path = BACKEND / "uv.lock"
    lock = lock_path.read_text(encoding="utf8") if lock_path.is_file() else ""

    declared_extras: set[str] = set()
    for spec in re.findall(r'unstructured\[([^\]]*)\]', pp):
        declared_extras |= set(re.findall(r"[a-z]+", spec))
    add(area, "pyproject 声明了 unstructured extras", bool(declared_extras),
        ",".join(sorted(declared_extras)) or "（没声明）",
        "unstructured 裸包只带纯文本，各格式的实现全在 extras 里")

    locked = _lock_unstructured_extras(lock)
    if not lock:
        add(area, "uv.lock 存在", False, "没有 uv.lock", "锁定版本：uv lock")
    elif declared_extras and not locked:
        add(area, "uv.lock 记录了同一组 extras", False,
            "lock 里的 unstructured 不带任何 extras ⇒ 一次全新 `uv sync` 就装不出解析依赖",
            "补 lock（uv lock，要联网）；或在部署机上显式装下面逐条点名的包")
    else:
        add(area, "uv.lock 记录了同一组 extras", not declared_extras or declared_extras <= locked,
            ",".join(sorted(locked)) or "（lock 里没有 extras）")

    for ext in sorted(LOADER_MAPPING):
        mods, exes = PARSERS.get(ext, ((), ()))
        missing = [display_for(m) for m in mods if not can_import(m)]
        lack_exe = [e for e in exes if not shutil.which(e)]
        if not missing and not lack_exe:
            add(area, f"{ext} 可解析", True)
            continue
        # 可执行文件不是 Python 依赖，不该混进「pyproject 有没有声明」的判断里
        not_declared = [m for m in missing if f'"{m.split("[")[0]}' not in pp]
        fix = "这种文件上传会得到 501。装：" + " ".join(missing + [f"{e}（apt/brew 级依赖）" for e in lack_exe])
        if not_declared:
            fix += f"（其中 {', '.join(not_declared)} 在 pyproject 里没直接声明；若是某个 extra 的传递依赖则属正常）"
        if "soffice" in lack_exe:
            fix += "｜旧版 Office 的另一条路：先用 LibreOffice 转成 .docx/.pptx 再传"
        elif "pandoc" in lack_exe:
            fix += "｜pandoc 装不上时的另一条路：把 .odt/.epub 先导出成 .md/.txt 再传"
        add(area, f"{ext} 可解析", False,
            "缺 " + "、".join(missing + [f"{e}（可执行文件）" for e in lack_exe]), fix)

    if can_import("spacy"):
        try:
            from spacy.util import is_package  # type: ignore

            have = bool(is_package("en_core_web_sm"))
            add(area, "spaCy en_core_web_sm 已就位", True if have else None,
                "已安装" if have else "未安装",
                "" if have else "unstructured 的部分分区会在解析时**联网下载**这个模型；"
                "离线机器提前 `python -m spacy download en_core_web_sm`")
        except Exception as exc:  # noqa: BLE001
            add(area, "spaCy 模型状态", None, f"查不了：{type(exc).__name__}")


# ══════════════════════════════════════════════════════════════
# 3. 外部服务
# ══════════════════════════════════════════════════════════════
async def _relation_db_facts() -> tuple[str, int, list[str], str | None, int]:
    """版本串、表数、角色名、alembic 版本、admin 账号数。一个事件循环里跑完。

    分几次 asyncio.run() 是实测炸过的：asyncpg 连接绑定在建立它的循环上，
    第二次循环复用池里的连接会得到「got Future attached to a different loop」。
    """
    from sqlalchemy import inspect, text

    from src.client import engine

    try:
        async with engine.connect() as c:
            version = str((await c.execute(text("select version()"))).scalar_one())
            names = await c.run_sync(lambda x: inspect(x).get_table_names())
            roles = []
            if "role" in names:
                roles = [r[0] for r in (await c.execute(text('select name from "role" order by id'))).all()]
            alembic = None
            if "alembic_version" in names:
                alembic = (await c.execute(text("select version_num from alembic_version"))).scalar()
            admins = 0
            if "user" in names:
                admins = (await c.execute(
                    text('select count(*) from "user" where role_id = 3')
                )).scalar_one()
            return version, len(names), roles, alembic, admins
    finally:
        await engine.dispose()


def check_services() -> None:
    area = "外部服务"
    try:
        version, ntables, roles, alembic, admins = asyncio.run(_relation_db_facts())
    except Exception as exc:  # noqa: BLE001
        add(area, "PostgreSQL 可连", False,
            f"{type(exc).__name__}: {str(exc).splitlines()[0][:140]}",
            "核对 POSTGRE_ADDR；库不存在就跑 scripts/init_db.py --create-database")
        return
    add(area, "PostgreSQL 可连", True, version.split(",")[0])
    add(area, "关系库表结构齐备", ntables >= 10, f"{ntables} 张表",
        "空库或表不齐：apps/backend/.venv/bin/python scripts/init_db.py")
    add(area, "role 表已播种（user/manager/admin）",
        {"user", "manager", "admin"} <= set(roles), ",".join(roles) or "（空）",
        "空 role 会让第一次注册撞外键违反（报错不提 role 表）：跑 scripts/init_db.py")
    add(area, "alembic_version 在 head", alembic == "c7e2a58f1b34", str(alembic),
        "缺 alembic_version → init_db.py 会 stamp；停在旧版本 → cd apps/backend && alembic upgrade head")
    add(area, "至少有一个 admin 账号", admins > 0, f"admin 数={admins}",
        "自助注册拿不到 admin（role_id 写死 1），/admin/* 会永远 403："
        "apps/backend/.venv/bin/python scripts/create_admin.py --name <你>")

    def redis() -> None:
        from src.client import get_redis

        try:
            add(area, "Redis 可连", get_redis().ping() is True)
        except Exception as exc:  # noqa: BLE001
            add(area, "Redis 可连", False, str(exc).splitlines()[0][:150],
                "docker compose -f apps/database/docker-compose.yml up -d redis；"
                "加了 requirepass 就填 REDIS_PASSWORD")

    def milvus() -> None:
        from src.config import milvus_host, milvus_port

        try:
            from pymilvus import MilvusClient

            names = MilvusClient(host=milvus_host, port=milvus_port, timeout=8).list_collections()
            add(area, "Milvus 可连", True, f"{milvus_host}:{milvus_port}，{len(names)} 个集合")
        except Exception as exc:  # noqa: BLE001
            add(area, "Milvus 可连", False, f"{type(exc).__name__}: {str(exc).splitlines()[0][:140]}",
                "docker compose -f apps/database/docker-compose.yml up -d milvus etcd minio")

    guard(area, "Redis", redis)
    guard(area, "Milvus", milvus)


# ══════════════════════════════════════════════════════════════
# 4. 推理面
# ══════════════════════════════════════════════════════════════
def check_inference(live: bool) -> None:
    area = "推理面"
    from src.config import settings
    from src.inference import auth, bindings

    st, body = auth.request("GET", "/v1/models", timeout=12)
    # xinference 3.x 把列表包在信封里：{'object':'list','data':[...]}（实测 3.5.0）。
    # 只认裸 list 的话，一条 200 会被读成「凭据不可用」—— 那是假红灯。
    models: list[str] = []
    if st == 200:
        items = body.get("data") if isinstance(body, dict) else body
    else:
        items = None
    if st == 200 and isinstance(items, list):
        models = [str(m.get("id") or m.get("model_name") or "?") for m in items]
        add(area, "xinference 可达且凭据可用", True, f"{auth.base_url()}，注册表里 {len(models)} 个模型")
    else:
        add(area, "xinference 可达且凭据可用", False, f"HTTP {st} {str(body)[:130]}",
            "填 XINFERENCE_ADMIN_USER / XINFERENCE_ADMIN_PASSWORD，或在管理台点「重连凭据」")
        return

    # 绑定要先从**表**里读进内存：bindings.snapshot() 读的是进程内快照，
    # 独立脚本里没人调过 refresh()，直接 snapshot() 会得到「全部来自 .env」的假答案
    # （而 .env 那三个 id 早就降级成第一次的种子了）。
    async def load_bindings() -> None:
        from src.client import async_session

        async with async_session() as s:
            await bindings.refresh(s)

    try:
        asyncio.run(load_bindings())
        bound = {role: bindings.current(role) for role in bindings.ROLES}
    except Exception as exc:  # noqa: BLE001
        add(area, "推理绑定可读", False, f"{type(exc).__name__}: {str(exc).splitlines()[0][:120]}",
            "关系库连不上时绑定表也读不到 —— 先修 Postgres")
        return
    for role, uid in sorted(bound.items()):
        add(area, f"绑定的 {role} 在注册表里", uid in models, str(uid),
            f"到管理台「模型推理」页加载 {uid}，或把绑定换成已在跑的模型")

    if not live:
        add(area, "推理活性探测", None, "未跑（加 --live 才真的打一次 embedding / rerank / 生成）",
            "注册表可读 ≠ 模型可用：这一轮撞到过 CUDA sticky device-side assert，"
            "48/57 次请求全回空回答，而 /v1/models 与 overview 都显示它在跑；"
            "而 bge-reranker-base 在注册表里躺着、加载时直接抛 CrossEncoder 构造错误")
        return

    import httpx

    token = auth.bearer()
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    def post(path_: str, payload: dict, timeout: float):
        return httpx.post(f"{auth.base_url()}{path_}", json=payload, headers=headers, timeout=timeout)

    emb = bound.get("embedding")
    if emb:
        try:
            r = post("/v1/embeddings", {"model": emb, "input": ["体检"]}, 60)
            vec = (r.json().get("data") or [{}])[0].get("embedding") or []
            dim_ok = len(vec) == settings.embedding_dimension
            add(area, "embedding 可用且维度与 EMBEDDING_DIMENSION 一致",
                r.status_code == 200 and bool(vec) and dim_ok,
                f"HTTP {r.status_code}，维度 {len(vec)} vs 配置 {settings.embedding_dimension}",
                "" if dim_ok else "维度不一致会在写 Milvus 时才炸（insert 报字段维度不符）："
                "改成模型的真实输出维度，或换模型")
        except Exception as exc:  # noqa: BLE001
            add(area, "embedding 可用", False, f"{type(exc).__name__}: {str(exc).splitlines()[0][:120]}")

    rk = bound.get("rerank")
    if rk:
        try:
            r = post("/v1/rerank", {"model": rk, "query": "体检", "documents": ["体检"], "top_n": 1}, 60)
            ok = r.status_code == 200 and bool((r.json() or {}).get("results"))
            add(area, "rerank 可用", ok or None, f"HTTP {r.status_code} {str(r.text)[:100]}" if not ok else "1 条结果",
                "重排不可用不影响「能不能部署」，但开着 MIN_RELEVANCE_SCORE 的入侧就会把依据筛没："
                f"要么换 uid，要么在管理台把 rerank 绑定指到一个真能加载的模型")
        except Exception as exc:  # noqa: BLE001
            add(area, "rerank 可用", None, f"{type(exc).__name__}: {str(exc).splitlines()[0][:120]}",
                "同上：这一条记为提醒而不是拦路 —— 系统不靠重排也能跑")

    llm = bound.get("llm")
    if not llm:
        add(area, "生成探测", False, "没有绑定 llm")
        return
    try:
        r = post(
            "/v1/chat/completions",
            {"model": llm, "messages": [{"role": "user", "content": "只回两个字：就绪"}],
             "max_tokens": 16, "stream": False},
            90,
        )
        try:
            out = (r.json()["choices"][0]["message"]["content"] or "").strip()
        except Exception:  # noqa: BLE001
            out = ""
        add(area, "生成探测（最小请求真的有内容）", r.status_code == 200 and bool(out),
            f"HTTP {r.status_code}，回了 {len(out)} 字",
            "" if out else "空回答：worker 很可能已进 CUDA sticky 状态，"
            "管理台 terminate 再 launch 这个模型才能恢复")
    except Exception as exc:  # noqa: BLE001
        add(area, "生成探测", False, f"{type(exc).__name__}: {str(exc).splitlines()[0][:130]}")


# ══════════════════════════════════════════════════════════════
# 5. 仓库完整性与前端
# ══════════════════════════════════════════════════════════════
# dev.sh / wait_for_models.sh 会 exec 这些文件。它们要是没进版本库，
# 「clone 下来就能跑」这句话就是假的 —— 症状是 tmux 窗口里一句 No such file or directory。
LAUNCHER_FILES = [
    "scripts/inference_env.sh",
    "scripts/start_inference.sh",
    "scripts/wait_for_models.sh",
    "scripts/wait_for_service.sh",
    "scripts/bound_models.py",
    "scripts/load_models.sh",
    "scripts/setup_inference_env.sh",
    "scripts/selfcheck_inference.py",
    "scripts/selfcheck_knowledge_base.py",
    "scripts/selfcheck_upload_cancel.py",
    "scripts/gate_inference_http.py",
    "scripts/init_db.py",
    "scripts/create_admin.py",
    "scripts/doctor.py",
]


def check_repo() -> None:
    area = "仓库与前端"

    def git(args: list[str]) -> str:
        p = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)
        return p.stdout

    try:
        tracked = set(git(["ls-files"]).splitlines())
    except Exception as exc:  # noqa: BLE001
        add(area, "git 可用", False, str(exc)[:120], "不在 git 工作区里时这一节没有意义")
        return
    if not tracked:
        add(area, "git 可用", None, "git ls-files 没返回东西（不是仓库？）")
        return

    missing = [f for f in LAUNCHER_FILES if f not in tracked]
    add(area, "启动链与 bootstrap 脚本都已入库", not missing,
        "、".join(missing) or "全部已跟踪",
        "新克隆的机器跑不起来：git add 这些文件（这一步我不替你提交）" if missing else "")
    untracked = [l for l in git(["status", "--porcelain"]).splitlines() if l.startswith("??")]
    add(area, "工作区没有成堆未跟踪文件", not untracked or None, f"{len(untracked)} 项未跟踪",
        "部署要用的东西如果在这些里面，它就不在别人的克隆里" if untracked else "")

    fe = ROOT / "apps" / "frontend"
    add(area, "前端依赖已安装", (fe / "node_modules").is_dir() or None,
        "node_modules 存在" if (fe / "node_modules").is_dir() else "还没 pnpm install",
        "cd apps/frontend && pnpm i")
    pkg = json.loads((fe / "package.json").read_text(encoding="utf8"))
    scripts = pkg.get("scripts") or {}
    add(area, "前端有生产构建脚本", "build" in scripts, str(scripts.get("build")))
    add(area, "自带 nginx 站点配置", (fe / "deploy" / "nginx.conf").is_file(),
        str(fe / "deploy" / "nginx.conf"), "没有的话前端只能跑 vite dev server")


def check_version_meta() -> None:
    """版本号必须只有一个答案。

    v0.2.0 那次发布后这里是四处三值：OpenAPI 写 1.0.0、`/health` 写 0.1.0、
    pyproject 写 0.1.0、package.json 写 0.0.0，而 tag 是 v0.2.0。
    「部署的是哪一版」问不出来，回滚就无从谈起。
    """
    area = "版本与 meta"
    import json as _json
    import re as _re

    from src.version import APP_VERSION

    pyproject = (BACKEND / "pyproject.toml").read_text(encoding="utf8")
    pp = _re.search(r'^version = "([^"]+)"', pyproject, _re.M)
    lock = (BACKEND / "uv.lock").read_text(encoding="utf8")
    lk = _re.search(r'name = "backend"\nversion = "([^"]+)"', lock)
    pkg = _json.loads((ROOT / "apps" / "frontend" / "package.json").read_text(encoding="utf8"))
    values = {
        "src/version.py": APP_VERSION,
        "pyproject.toml": pp.group(1) if pp else None,
        "uv.lock(backend)": lk.group(1) if lk else None,
        "package.json": pkg.get("version"),
    }
    same = len(set(values.values())) == 1 and APP_VERSION not in (None, "")
    add(area, "四处版本号一致", same or None,
        " / ".join(f"{k}={v}" for k, v in values.items()),
        "" if same else "按 src/version.py 顶部的清单一次改齐（改 lock 只动那一行 version，"
        "不要顺手 uv lock —— 那要联网重解析）")
    try:
        tags = subprocess.run(["git", "-C", str(ROOT), "tag", "--sort=-v:refname"],
                              capture_output=True, text=True).stdout.split()
    except Exception:  # noqa: BLE001
        tags = []
    latest = tags[0] if tags else None
    add(area, "最新的 tag 对得上当前版本", latest == f"v{APP_VERSION}" or None,
        f"tag={latest} 代码={APP_VERSION}",
        "发布要走：commit → git tag -a v<版本> → push --follow-tags" if latest != f"v{APP_VERSION}" else "")


def main() -> int:
    ap = argparse.ArgumentParser(description="部署体检（只读，什么都不改）")
    ap.add_argument("--live", action="store_true",
                    help="真的调用一次 embedding / rerank / 生成（慢 5-90s，但这是唯一能证明模型可用的检查）")
    ap.add_argument("--json", action="store_true", help="输出 JSON 而不是人读格式")
    ap.add_argument("-v", "--verbose", action="store_true", help="连 OK 行一起打")
    args = ap.parse_args()

    print(f"体检目标：{ROOT}")
    print(f"Python：{sys.version.split()[0]}  驱动：{Path(sys.executable).parent}")
    try:
        from src.config import settings
    except Exception as exc:  # noqa: BLE001
        # 配置读不出来，后面的每一条检查都没有意义 —— 直接把这条说清楚
        print(f"✗ [配置] .env 加载失败：{str(exc).splitlines()[0]}")
        print("    ↳ 这是拦路的：cp apps/backend/.env.example apps/backend/.env 再填值")
        return 1

    check_config(settings)
    guard("解析能力", "解析能力检查", check_parsers)
    guard("外部服务", "外部服务检查", check_services)
    guard("推理面", "推理面检查", lambda: check_inference(args.live))
    guard("仓库与前端", "仓库检查", check_repo)
    guard("版本与 meta", "版本检查", check_version_meta)

    fails = [r for r in ROWS if r.level == "FAIL"]
    warns = [r for r in ROWS if r.level == "WARN"]

    if args.json:
        print(json.dumps({"fail": len(fails), "warn": len(warns),
                          "rows": [r.as_dict() for r in ROWS]}, ensure_ascii=False, indent=2))
        return 1 if fails else 0

    order = {"FAIL": 0, "WARN": 1, "OK": 2}
    # 按检查发生的顺序分区（配置 → 解析 → 服务 → 推理 → 仓库），
    # 而不是按分区名的字面排序 —— 中文标题排出来的顺序没有意义，还会把「配置」放最后。
    seen: list[str] = []
    for r in ROWS:
        if r.area not in seen:
            seen.append(r.area)
    printed: set[str] = set()
    for row in sorted(ROWS, key=lambda r: (seen.index(r.area), order[r.level])):
        if row.area not in printed:
            printed.add(row.area)
            print(f"\n── {row.area} " + "─" * max(0, 40 - len(row.area)))
        if row.level == "OK" and not args.verbose:
            continue
        mark = {"OK": "✓", "WARN": "!", "FAIL": "✗"}[row.level]
        print(f"{mark} {row.label}" + (f" — {row.detail}" if row.detail else ""))
        if row.level != "OK" and row.fix:
            print(f"    ↳ {row.fix}")

    print(f"\n通过 {sum(1 for r in ROWS if r.level == 'OK')} 项，"
          f"警告 {len(warns)} 项，失败 {len(fails)} 项。")
    print("结论：" + ("还有拦路的问题，按上面 ✗ 的 ↳ 逐条修。" if fails else
                     "没有拦路问题；! 是会让某个功能降级、但不挡部署的缺口。"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
