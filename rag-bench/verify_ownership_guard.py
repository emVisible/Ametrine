#!/usr/bin/env python
"""验证新加的「集合归属」守卫：请求 (库 A, 集合 X) 而 X 属于库 B 时，必须 409 并点名真正的库。

这条不是假想缺陷：上一轮我把同名集合用在两个库里，PG 行写进了 B 的集合、
向量写进了 A 的 Milvus 库，而 409 的措辞还写着「已存在于 ragbench_formats」——
看起来像去重正常工作，其实是两处已经错开了。
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = os.environ.get("AMETRINE_BENCH_BASE", "http://127.0.0.1:3010/api")


def login(pw: str) -> str:
    form = urllib.parse.urlencode({"username": "ragbench", "password": pw}).encode()
    req = urllib.request.Request(BASE + "/auth", data=form, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())["access_token"]


def post_multipart(tok: str, path: str, filename: str, blob: bytes, fields: dict):
    """上传一条真实的多部件请求。

    两个坑都是我自己踩过的：
    · `BASE` 已经带 `/api` 了，这里再写 `/api/...` 就是 404（上一版就是这样，
      然后我差点把「守卫没生效」写进报告）；
    · 这两个参数是**表单字段**（ingest.py 用的就是 fields），不是查询串。
    """
    boundary = uuid.uuid4().hex
    prefix = "".join(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n"
        for k, v in fields.items())
    head = (
        prefix
        + f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
        + f"filename=\"{filename}\"\r\nContent-Type: text/markdown\r\n\r\n"
    ).encode()
    body = head + blob + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE + path, data=body, method="POST", headers={
        "Authorization": "Bearer " + tok,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    })
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def main() -> int:
    # 口令优先从 ACCOUNT 读：这条链路上 `$(cat …)` 会被外层 Git Bash 求值成空串（已踩过），
    # 一个要传口令的验证脚本如果靠 shell  substitution，失败时根本分不清是口令还是系统。
    if len(sys.argv) > 1:
        pw = sys.argv[1]
    else:
        account = Path(__file__).resolve().parent / "ACCOUNT"
        pw = account.read_text(encoding="utf-8").strip() if account.exists() else ""
        if not pw:
            print("✗ 没有口令：把 ragbench 的口令作为参数传进来，或写进 rag-bench/ACCOUNT")
            return 1
    tok = login(pw)
    doc = (f"# 归属守卫探针 {uuid.uuid4().hex}\n\n"
           "这一篇只用来验证拒绝路径，正文足够长以免被别的检查挡下。").encode()

    # 1) 负样本：库 ragbench_fast + 集合 ragbench_formats（那个集合其实属于 ragbench_fmt）
    st, res = post_multipart(
        tok, "/relation/document/upload", f"ownership-probe-{uuid.uuid4().hex[:6]}.md", doc,
        {"database_name": "ragbench_fast", "collection_name": "ragbench_formats"})
    print("跨库同名集合 →", st, res[:220])
    ok_reject = st == 409 and "ragbench_fmt" in res

    # 2) 正样本：同一对参数如果本来就是合法的（库 ragbench_fmt + 集合 ragbench_formats），
    #    守卫不许把它也拒掉 —— 否则「修复」就变成了「这条路彻底走不通」。
    st2, res2 = post_multipart(
        tok, "/relation/document/upload", f"ownership-ok-{uuid.uuid4().hex[:6]}.md", doc,
        {"database_name": "ragbench_fmt", "collection_name": "ragbench_formats"})
    print("同库合法配对 →", st2, res2[:160])
    ok_accept = st2 == 200

    # 清掉正样本真的写进去的那篇（走应用自己的删除，级联清 PG + Milvus + 盘上原文）
    if ok_accept:
        try:
            doc_id = (json.loads(res2).get("data") or {}).get("document_id")
        except Exception:  # noqa: BLE001
            doc_id = None
        if doc_id:
            # BASE 已经带 /api，这里再拼一次就是 404 —— 上一版正是这样把清场弄失败的。
            r = urllib.request.Request(BASE + f"/relation/document/{doc_id}",
                                       method="DELETE",
                                       headers={"Authorization": "Bearer " + tok})
            try:
                with urllib.request.urlopen(r, timeout=90) as resp:
                    print(f"清场：删除探针文档 {doc_id[:8]} → HTTP {resp.status}")
            except urllib.error.HTTPError as e:
                # 清不掉会留下一篇没人引用的文档，所以这句话要打得出来而不是崩掉
                print(f"清场失败：HTTP {e.code} {e.read().decode('utf-8', 'replace')[:140]}")
    else:
        print("（正样本未成功，无需清场）")

    print()
    print("✓ 守卫按预期工作" if (ok_reject and ok_accept) else "✗ 结果不符合预期")
    return 0 if (ok_reject and ok_accept) else 1


if __name__ == "__main__":
    sys.exit(main())
