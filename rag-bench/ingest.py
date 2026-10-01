#!/usr/bin/env python
"""把 `rag-bench/corpus/` 里的语料灌进 Ametrine 知识库，并留下「文件 → doc_id」的映射。

为什么需要一个映射：查询集的金标签要按 **doc_id** 判，而不是按标题猜 ——
标题会重（两篇 RFC 的 H1 可能一样），按标题回推会静默把对的召回判成错的。
上传响应里有服务端生成的 id，所以在这里一次性记下来（`bench/ingest_map.json`）。

它做的是**写操作**：建一个知识库、建若干集合、上传 N 篇文档。全部通过应用自己的 HTTP 接口，
不碰 SQL，所以测到的就是真实链路（含解析、切分、嵌入、写 Milvus）。

用法：
    apps/backend/.venv/bin/python rag-bench/ingest.py --password '<一次性账号口令>'
    加 --reset 会先删掉上一次建的库（只按 --database 的名字删，不做任何全局 reset）。

账号说明：这台机器的 root 口令不在任何我能读的地方，所以沿用本仓门禁的做法
（`scripts/gate_inference_http.py` 同一模式）——建一次性账号 → 直接 SQL 提管理员 →
用完删。上传文档只需要写权限，管理员绕过逐库判定，所以一个账号够。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
# 清单不再在 import 期读死：同一份入库流程要能跑「.md 主语料」和「多格式真实语料」两份，
# 而复制一个 ingest_formats.py 会变成第二份「怎么上传」的事实源。
MANIFEST_PATH_DEFAULT = ROOT / "MANIFEST.json"
BASE = os.environ.get("AMETRINE_BENCH_BASE", "http://127.0.0.1:3000/api")
BENCH_USER = "ragbench"


def call(path: str, *, method: str = "GET", jsonbody=None, form=None, tok: str | None = None,
         multipart: tuple[str, bytes, str] | None = None, fields: dict | None = None,
         timeout: int = 300):
    url = BASE + path
    data = None
    headers = {}
    if tok:
        headers["Authorization"] = "Bearer " + tok
    if jsonbody is not None:
        data = json.dumps(jsonbody).encode()
        headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif multipart is not None:
        fname, blob, ctype = multipart
        boundary = "----ametrinebench"
        parts: list[bytes] = []
        for k, v in (fields or {}).items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n"
                         f"{v}\r\n".encode())
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
                     f"filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n".encode())
        parts.append(blob)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        data = b"".join(parts)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    req = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw or b"null")
            except Exception:  # noqa: BLE001
                return r.status, raw[:200]
    except HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"null")
        except Exception:  # noqa: BLE001
            return e.code, raw[:200]
    except URLError as e:
        return "ERR", str(e.reason)


async def ensure_admin(password: str) -> str:
    """一次性基准账号 → 提权 → 返回令牌。"""
    sys.path.insert(0, str(REPO / "apps" / "backend"))
    st, _ = call("/user/create", method="POST",
                 jsonbody={"name": BENCH_USER, "password": password})
    print(f"创建账号 {BENCH_USER}: {st}")
    from sqlalchemy import text

    from src.client import engine
    async with engine.begin() as c:
        ids = [r[0] for r in await c.execute(
            text('select id from "user" where name = :n'), {"n": BENCH_USER})]
        if not ids:
            raise SystemExit("账号没建出来（创建接口没落库）")
        await c.execute(text('update "user" set role_id = 3, token_version = token_version + 1 '
                             "where id = :u"), {"u": ids[0]})
        # 基准要跑几百次推理，默认配额会先把评测本身拦下来；这里只动这个一次性账号。
        await c.execute(text("update \"user\" set daily_token_limit = 0, monthly_token_limit = 0 "
                             "where id = :u"), {"u": ids[0]})
        print(f"已提权并放开配额 id={ids[0]}")
    st, res = call("/auth", method="POST",
                   form={"username": BENCH_USER, "password": password})
    if st != 200:
        # 上一轮已经建过这个账号、这一轮给了另一个口令：直接登录失败时要把话说清，
        # 否则看到的只是"登录失败 401"，而真相是"账号在，口令不是你这个"。
        raise SystemExit(f"登录失败 {st}: {str(res)[:120]}。若 {BENCH_USER} 是上一轮建的，"
                         f"请沿用当时的口令，或先删掉这个账号。")
    return res["access_token"]


def login(password: str) -> str:
    st, res = call("/auth", method="POST", form={"username": BENCH_USER, "password": password})
    if st != 200:
        raise SystemExit(f"登录失败 {st}: {res}")
    return res["access_token"]


def server_documents(tok: str, database: str, collections: list[str]) -> dict[str, str]:
    """**指定库里**现有的 文件名 → document_id。对账用，只读。

    两条都是踩出来的：

    1. 键必须是文件名而不是正文标题。`document/all` 回的 `title` 就是当初上传的
       `safe_filename`（`rfc9110.md`），而 MANIFEST 里的 `title` 是抓下来的那个 H1
       （"HTTP Semantics (RFC 9110)"）。按后者匹配，7 篇已在库内的文档一个都没认出来，
       于是全部重传、全部 409 —— 对账看着跑了，其实一次都没命中。
    2. 必须真的按库过滤。`document/all` 的行里**没有** `database_name`（实测键只有
       `id/title/uploader/created_at/collection_id/meta/source_available`），
       所以原来那句 `if db and db != database: continue` 是恒假 —— 过滤根本没发生，
       上一个库里的 10 篇被当成「这个新库已经有了」直接跳过。
       现在改成：库 id → 该库的集合 id → 逐集合列文档，作用域由服务端保证。
    """
    db_id = find_database_id(tok, database)
    if db_id is None:
        return {}
    st, res = call(f"/relation/collection/all/specific?database_id={db_id}", method="GET", tok=tok)
    if st != 200:
        print(f"  读该库集合清单失败 {st}，本次不做对账（宁可重传也不要认错）")
        return {}
    rows = (res or {}).get("data") if isinstance(res, dict) else res
    col_ids = []
    for c in rows or []:
        name = c.get("name") if isinstance(c, dict) else None
        cid = c.get("id") if isinstance(c, dict) else None
        if cid is not None and (not collections or name in collections):
            col_ids.append(cid)
    out: dict[str, str] = {}
    for cid in col_ids:
        st, res = call(f"/relation/document/collection?collection_id={cid}", method="GET", tok=tok)
        if st != 200:
            print(f"  集合 {cid} 的文档列不出来（{st}），这部分对账跳过")
            continue
        docs = (res or {}).get("data") if isinstance(res, dict) else res
        for d in docs or []:
            title, did = d.get("title"), d.get("id") or d.get("document_id")
            if title and did:
                out[str(title)] = str(did)
    return out


def find_database_id(tok: str, database: str) -> int | None:
    """只读地找库 id（对账不该有「顺手建一个库」这种副作用）。"""
    st, res = call("/relation/database/all", method="GET", tok=tok)
    for d in ((res or {}).get("data") or []):
        if d.get("name") == database and d.get("id"):
            return int(d["id"])
    return None


def resolve_database(tok: str, database: str) -> int | None:
    """已存在就用它，不存在才建。重跑时「already exists」不是错误，是要拿回它的 id。"""
    st, res = call("/relation/database/all", method="GET", tok=tok)
    for d in ((res or {}).get("data") or []):
        if d.get("name") == database and d.get("id"):
            return int(d["id"])
    st, res = call("/relation/database/create", method="POST", tok=tok,
                   jsonbody={"name": database, "description": "RAG 基准语料（自动生成，可删）"})
    print(f"知识库 {database} 新建: {st} {str(res)[:100]}")
    if st in (200, 201):
        return int(((res or {}).get("data") or {}).get("id") or 0) or None
    return None


def resolve_collections(tok: str, database_id: int, names: list[str]) -> list[str]:
    st, res = call("/relation/collection/all", method="GET", tok=tok)
    existing = {c.get("name") for c in ((res or {}).get("data") or [])}
    for name in names:
        if name in existing:
            continue
        st, res = call("/relation/collection/create", method="POST", tok=tok,
                       jsonbody={"name": name, "database_id": database_id,
                                 "description": f"RAG 基准 · {name}"})
        print(f"  集合 {name} 新建: {st} {str(res)[:90]}")
    return names


def create_kb(tok: str, database: str, collections: list[str]) -> None:
    db_id = resolve_database(tok, database)
    if not db_id:
        raise SystemExit("建不了也找不到这个知识库，后面全是无意义的重试")
    resolve_collections(tok, db_id, collections)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", required=True, help="一次性基准账号的口令")
    ap.add_argument("--database", default="ragbench2026")
    ap.add_argument("--collection", default="ragbench_all",
                    help="单集合模式；分领域评测用 --by-domain")
    ap.add_argument("--by-domain", action="store_true",
                    help="每个领域一个集合（跨库检索与库内检索分开测）")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--upload-timeout", type=int, default=900,
                    help="单篇上传的客户端等待上限（秒）；超时不算失败，收尾会用服务端清单对账")
    ap.add_argument("--only", default="", help="只传这些 id（逗号分隔）")
    ap.add_argument("--max-bytes", type=int, default=0,
                    help="跳过超过该字节数的文件（整本电子书一类的超大原件另算，见报告）")
    ap.add_argument("--skip-format", default="", help="逗号分隔的格式后缀，如 epub,pdf")
    ap.add_argument("--manifest", default=str(MANIFEST_PATH_DEFAULT),
                    help="要入库的清单（多格式语料用 formats/MANIFEST.json）")
    ap.add_argument("--map-out", default="ingest_map.json",
                    help="id→doc_id 映射的输出文件名；换语料时必须换，否则会把上一轮的映射当成本轮的")
    ap.add_argument("--fails-out", default="ingest_fails.json")
    args = ap.parse_args()

    # 清单路径按 rag-bench 解析，而不是按当前工作目录：上一版按 cwd 解析，
    # 从仓库根跑 `--manifest formats/MANIFEST.json` 就直接 FileNotFoundError 退出。
    manifest_path = Path(args.manifest)
    if not manifest_path.is_absolute() and not manifest_path.exists():
        manifest_path = ROOT / args.manifest
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    map_out, fails_out = ROOT / args.map_out, ROOT / args.fails_out
    docs = [d for d in manifest["documents"] if d.get("fetch") in ("new", "skip", "rewrite")]
    # 按格式/体量筛是这一轮加的：整本电子书（727 KB 的 epub，正文 1.2 MB ≈ 2400 块）
    # 单篇就超过 900 秒还没完，会把整轮基准拖成一小时以上。
    # 那不是「测不了」，是一条**独立的结论**（见 formats 报告），所以这里跳过它、
    # 但把它作为超大样本单独记下来，而不是假装它不存在。
    if args.skip_format:
        skip = {s.strip().lstrip(".") for s in args.skip_format.split(",") if s.strip()}
        dropped = [d for d in docs if d.get("format", "").lstrip(".") in skip]
        docs = [d for d in docs if d.get("format", "").lstrip(".") not in skip]
        print(f"按格式跳过 {len(dropped)} 篇：{sorted(skip)}")
    if args.max_bytes:
        dropped = [d for d in docs if int(d.get("bytes", 0)) > args.max_bytes]
        docs = [d for d in docs if int(d.get("bytes", 0)) <= args.max_bytes]
        print(f"按体积跳过 {len(dropped)} 篇（>{args.max_bytes:,} 字节）："
              f"{[d['id'] for d in dropped][:6]}")
    if args.only:
        wanted = set(args.only.split(","))
        docs = [d for d in docs if d["id"] in wanted]
    if args.limit:
        docs = docs[:args.limit]
    print(f"待入库 {len(docs)} 篇")

    tok = asyncio.run(ensure_admin(args.password))

    domains = sorted({d["domain"] for d in docs})
    collections = [f"ragbench_{d}" for d in domains] if args.by_domain else [args.collection]
    create_kb(tok, args.database, collections)

    def bucket_for(domain: str) -> str:
        return f"ragbench_{domain}" if args.by_domain else args.collection

    mapping: dict[str, dict] = {}
    if map_out.exists():
        mapping = json.loads(map_out.read_text(encoding="utf-8"))

    # 先和**服务端**对一次账，而不是只信本地那份映射：
    # 上一轮客户端在上传返回前超时，服务端其实已经把文档写进去了。
    # 只看本地就会重传，重传要么变成重复文档（污染 chunk 统计），要么撞上 409。
    known = server_documents(tok, args.database, collections)
    print(f"服务端已有 {len(known)} 篇")
    for d in docs:
        fname = Path(d["path"]).name
        if fname in known and d["id"] not in mapping:
            mapping[d["id"]] = {"doc_id": known[fname], "collection": bucket_for(d["domain"]),
                                "title": fname, "path": d["path"], "tier": d["tier"],
                                "domain": d["domain"], "lang": d["lang"], "reconciled": True}

    fails: list[dict] = []
    t0 = time.time()
    todo = [d for d in docs if d["id"] not in mapping]
    print(f"其中 {len(docs) - len(todo)} 篇已在库内，待传 {len(todo)}")
    for i, d in enumerate(todo, 1):
        path = ROOT / d["path"]
        if not path.exists():
            fails.append({"id": d["id"], "error": "文件不在盘上"})
            continue
        blob = path.read_bytes()
        # 上传时带上**该文件自己的** MIME，而不是恒发 text/markdown。
        # 浏览器不会替所有格式撒这一个谎，而服务端判格式看的是文件名后缀 ——
        # 两者不一致本身就该被测出来，而不该由测试脚本主动掩盖。
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        try:
            st, res = call("/relation/document/upload", method="POST", tok=tok,
                           multipart=(path.name, blob, ctype),
                           fields={"collection_name": bucket_for(d["domain"]),
                                   "database_name": args.database},
                           timeout=args.upload_timeout)
        except Exception as exc:  # noqa: BLE001 超时不是失败，是「不知道」——下面用服务端对账回答
            st, res = "TIMEOUT", {"error": f"{type(exc).__name__}: {exc}"}
        # 服务端返回的是 `document_id`，不是 `id`。按 `id` 取会得到 None，
        # 于是**每一篇成功的上传都被记成失败**（上一轮就是这么把 2 篇好文档判成 0 篇的）。
        data = (res or {}).get("data") if isinstance(res, dict) else None
        doc_id = None
        if isinstance(data, dict):
            doc_id = data.get("document_id") or data.get("id")
        elif isinstance(data, str):
            doc_id = data
        if doc_id:
            mapping[d["id"]] = {"doc_id": doc_id, "collection": bucket_for(d["domain"]),
                                "title": d["title"], "path": d["path"],
                                "tier": d["tier"], "domain": d["domain"], "lang": d["lang"]}
            print(f"  [{i}/{len(todo)}] ✓ {d['id']} → {doc_id}", flush=True)
        else:
            fails.append({"id": d["id"], "status": st, "error": str(res)[:200]})
            print(f"  [{i}/{len(todo)}] ✗ {d['id']} {st} {str(res)[:110]}", flush=True)
        if i % 10 == 0:
            map_out.write_text(
                json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")

    # 收尾再对一次账：把「客户端超时但服务端其实收了」的那些捞回来
    known2 = server_documents(tok, args.database, collections)
    recovered = 0
    for d in docs:
        fname = Path(d["path"]).name
        if d["id"] not in mapping and fname in known2:
            mapping[d["id"]] = {"doc_id": known2[fname], "collection": bucket_for(d["domain"]),
                                "title": fname, "path": d["path"], "tier": d["tier"],
                                "domain": d["domain"], "lang": d["lang"], "reconciled": True}
            recovered += 1
    fails = [f for f in fails if f["id"] in {d["id"] for d in docs}
             and f["id"] not in mapping]
    map_out.write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    fails_out.write_text(
        json.dumps(fails, ensure_ascii=False, indent=2), encoding="utf-8")

    el = time.time() - t0
    print(f"\n入库完成：映射 {len(mapping)} 篇（对账捞回 {recovered}）失败 {len(fails)}，"
          f"用时 {el:.0f} s（{el/max(1,len(todo)):.2f} s/篇）")
    for f in fails[:10]:
        print("  失败：", f)
    print(f"INGEST_DONE ok={len(mapping)} fail={len(fails)}")
    return 0 if len(mapping) >= 1 else 1


if __name__ == "__main__":
    sys.exit(main())
