#!/usr/bin/env python
"""推理管理面的**活体**门禁（打真服务器，跑完自己清场）。

`selfcheck_inference.py` 查的是进程内的装配；这个查的是 HTTP 语义 ——
「写路径 + 失败看得见」这两类最容易假过的东西，只有在跑着的服务上才测得到：

  · PUT 绑定之后，**同一个进程**要立刻读得到新值（漏写 `global` 那个 bug 就是从这看的）
  · POST 加载一个不存在的模型：必须 202，并且几秒内在 `launch_errors` 里留下原因
    —— 否则用户点「加载」看到的就是「什么都不发生」
  · 卸载当前被绑定的模型必须 409，而不是把人家的索引拆了
  · 整面在鉴权之前就不该答话（匿名 401、普通用户 403）

它**会**动数据：建一个一次性账号、把它提成管理员、写一次 rerank 绑定再还原。
删账号放在 `finally` 里，并且走应用自己的 `DELETE /api/user/delete`（级联会话与消息），
不用裸 SQL —— 崩在中途时它只**报告**残留，不替人做删行的决定。

用法（后端在 :3000 跑着、数据库在跑）：
    apps/backend/.venv/bin/python scripts/gate_inference_http.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BACKEND = Path(__file__).resolve().parent.parent / "apps" / "backend"
sys.path.insert(0, str(BACKEND))

BASE = os.environ.get("AMETRINE_BACKEND_BASE", "http://127.0.0.1:3000")
# 名字每次不同：跑崩过一次留下同名账号，下一次就是「创建失败」而不是测出真问题
NAME = f"qa-inf-{os.getpid()}"[:30]
PWD = "Probe-Pass-2026!"
PROBE_UID = "__probe_rerank__"
BOGUS = "no-such-model-for-selfcheck"
FAILS: list[str] = []


def req(path, method="GET", data=None, tok=None, jsonbody=None, timeout=30):
    body, headers = None, {}
    if jsonbody is not None:
        body, headers["Content-Type"] = json.dumps(jsonbody).encode(), "application/json"
    elif data is not None:
        body, headers["Content-Type"] = (
            urlencode(data).encode(),
            "application/x-www-form-urlencoded",
        )
    if tok:
        headers["Authorization"] = "Bearer " + tok
    r = Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except Exception:  # noqa: BLE001
                return resp.status, raw[:200].decode("utf-8", "replace")
    except HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:  # noqa: BLE001
            return e.code, raw[:200].decode("utf-8", "replace")
    except URLError as e:
        return "ERR", str(e.reason)


def check(label, ok, detail=""):
    print(f"  {'✓' if ok else '✗'} {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILS.append(label)


def login() -> str | None:
    st, res = req("/api/auth", "POST", data={"username": NAME, "password": PWD})
    return res.get("access_token") if st == 200 and isinstance(res, dict) else None


async def run():
    from sqlalchemy import text

    from src.client import engine

    uid: int | None = None
    admin_tok: str | None = None
    before: dict[str, str] = {}

    try:
        print("=== 1) 匿名一律 401 ===")
        for p, m in (
            ("/api/inference/overview", "GET"),
            ("/api/inference/bindings/rerank", "PUT"),
            ("/api/inference/models", "POST"),
        ):
            st, _ = req(p, m, jsonbody={"model_uid": "x"} if m != "GET" else None)
            check(f"{m} {p}", st == 401, f"HTTP {st}")

        print("\n=== 2) 一次性账号：普通用户 403，管理员 200 ===")
        req("/api/user/create", "POST", jsonbody={"name": NAME, "password": PWD})
        user_tok = login()
        if not user_tok:
            check("一次性账号能登录", False, "登录没拿到令牌")
            return
        async with engine.begin() as c:
            got = [r[0] for r in await c.execute(
                text('select id from "user" where name = :n'), {"n": NAME}
            )]
        if not got:
            check("一次性账号建出来了", False, "创建接口没落库")
            return
        uid = got[0]
        st, _ = req("/api/inference/overview", tok=user_tok)
        check("普通用户 403", st == 403, f"HTTP {st}")

        # 提成管理员走 SQL，不用应用自己的 PATCH：后者正是本项目已知的越权洞，
        # 拿缺陷当后门跑门禁 = 把洞藏进「测试通过」。同时升 token_version，
        # 否则旧令牌按 JWT 里的角色继续生效，测到的会是上一个身份。
        async with engine.begin() as c:
            await c.execute(
                text('update "user" set role_id = 3, token_version = token_version + 1 '
                     "where id = :u"),
                {"u": uid},
            )
        admin_tok = login()
        st, body = req("/api/inference/overview", tok=admin_tok)
        d = (body or {}).get("data") or {}
        check("管理员 200", st == 200, f"HTTP {st}")
        # 共享句柄现在是惰性的：后端刚起来、还没人推理时它就是还没建。
        # 所以「凭据可用」= 令牌在手；只有**句柄已建却不带 Authorization** 才是真故障。
        a = d.get("auth") or {}
        check(
            "凭据可用（令牌在手；句柄若已建则必须带上 Authorization）",
            bool(a.get("has_token")) and (not a.get("shared_client_built") or bool(d.get("client_has_credential"))),
            json.dumps({k: a.get(k) for k in ("has_token", "shared_client_built")})
            + f" client={d.get('client_has_credential')}",
        )
        roles = (d.get("bindings") or {}).get("roles") or []
        check(
            "快照不是靠 .env 兜底（漏写 global 那个 bug 的活体判据）",
            bool(roles) and all(not r["from_settings"] for r in roles),
            json.dumps([(r["role"], r["from_settings"]) for r in roles]),
        )
        check("显存读数是真的", bool((d.get("gpu") or {}).get("gpus")),
              json.dumps((d.get("gpu") or {}).get("gpus"), ensure_ascii=False)[:120])
        # 加载页那行「上下文长度低于应用侧预算」的风险提示，唯一的事实来源就是这个块。
        # 缺了它界面会静默不警告（`app?.max_model_len` 为 undefined ⇒ 永远不触发），
        # 数值不对则更糟：警告会说谎。所以这里比对的是**本进程现读的配置**，
        # 而不是一个写死的期望值 —— 改 .env 后两边必须一起动。
        from src import config as cfg  # 局部导入：别和上面循环里的 `p` 撞名

        app = d.get("app") or {}
        check(
            "应用侧假设随 overview 一起到达（UI 的警告有依据）",
            app.get("max_model_len") == cfg.max_model_len
            and app.get("top_k") == cfg.k
            and app.get("context_size") == cfg.p
            and app.get("embedding_dimension") == cfg.embedding_dimension
            and int(app.get("max_model_len") or 0) > 0,
            json.dumps({**{k2: v for k2, v in app.items()},
                        "env": cfg.max_model_len}),
        )
        before = {r["role"]: r["model_uid"] for r in roles}

        print("\n=== 3) 写绑定：改完立刻读要一致，且记下是谁改的 ===")
        st, body = req("/api/inference/bindings/rerank", "PUT",
                       jsonbody={"model_uid": PROBE_UID, "model_name": PROBE_UID},
                       tok=admin_tok)
        after = {r["role"]: r["model_uid"]
                 for r in ((body or {}).get("data") or {}).get("roles") or []}
        check("PUT 返回 200", st == 200, f"HTTP {st}")
        check("响应里就是新值", after.get("rerank") == PROBE_UID, str(after.get("rerank")))
        st, body = req("/api/inference/bindings", tok=admin_tok)
        got2 = {r["role"]: r["model_uid"]
                for r in ((body or {}).get("data") or {}).get("roles") or []}
        check("GET 再读仍是新值（进程内快照同步了）", got2.get("rerank") == PROBE_UID,
              str(got2.get("rerank")))
        async with engine.begin() as c:
            upd = [tuple(r) for r in await c.execute(
                text("select model_uid, updated_by from inference_role_binding "
                     "where role='rerank'"))][0]
        check("库里也是新值，且 updated_by 记了操作者",
              upd[0] == PROBE_UID and upd[1] == uid, str(upd))
        # 负样本：此刻 rerank 绑到一个**没加载**的 uid 上，活性探测必须说「不可用」。
        # 没有这一条，探测完全可以一路回 ok=true 还「全绿通过」—— 而那正是这次要修的病。
        st, body = req("/api/inference/liveness", "POST", tok=admin_tok)
        live = (body or {}).get("data") or {}
        rows = {p["role"]: p for p in live.get("probes") or []}
        check("绑到没加载的模型时探测报不可用（负样本，证明它会红）",
              st == 200 and "rerank" in rows and rows["rerank"]["ok"] is False,
              json.dumps(rows.get("rerank"), ensure_ascii=False)[:150])
        # 立刻还原，再往下测护栏：下面第 4 条的前提是「这个 uid 正被绑定」，
        # 绑定还停在探针值上时它当然能删 —— 上一版就是把还原挪到了最后，
        # 于是这条check 报的是 200 而不是 409，看着像护栏坏了，其实是我把题出错了。
        st, _ = req("/api/inference/bindings/rerank", "PUT",
                    jsonbody={"model_uid": before["rerank"], "model_name": before["rerank"]},
                    tok=admin_tok)
        restored = st == 200
        check("rerank 绑定已还原", restored, f"HTTP {st}")

        print("\n=== 4) 护栏：卸载当前绑定的模型必须 409 ===")
        st, body = req("/api/inference/models/" + before["rerank"], "DELETE", tok=admin_tok)
        check("DELETE 被绑定的 uid → 409", st == 409, f"HTTP {st} {str(body)[:90]}")

        print("\n=== 5) 未知角色 422、目录可读 ===")
        st, _ = req("/api/inference/bindings/nonsense", "PUT",
                    jsonbody={"model_uid": "x"}, tok=admin_tok)
        check("未知角色 → 422", st == 422, f"HTTP {st}")
        st, body = req("/api/inference/families", tok=admin_tok)
        fam = (body or {}).get("data") or {}
        check("families 有内容", bool(fam.get("chat")), f"chat={len(fam.get('chat') or [])} 个")
        # 目录的第一层：界面上「挑一个型号来加载」靠它，没有清单那句话就是假话。
        st, body = req("/api/inference/registrations?model_type=embedding", tok=admin_tok)
        rows = ((body or {}).get("data") or {}).get("models") or []
        check(
            "registrations 列得出该类型的型号名",
            st == 200 and len(rows) > 0 and all("model_name" in r for r in rows),
            f"HTTP {st} n={len(rows)} 例={[r.get('model_name') for r in rows[:3]]}",
        )
        st, _ = req("/api/inference/registrations?model_type=nonsense", tok=admin_tok)
        check("未知类型 → 422（不去替服务器猜类型）", st == 422, f"HTTP {st}")

        print("\n=== 6) 加载一个不存在的型号：受理之后必须变成看得见的失败 ===")
        st, _ = req("/api/inference/models", "POST", tok=admin_tok,
                    jsonbody={"model_name": BOGUS, "model_type": "rerank"})
        check("POST → 202", st == 202, f"HTTP {st}")
        # 60 秒看门狗 + 余量。等不到就是「界面会永远转圈」那个缺陷回来了。
        seen = None
        for _ in range(30):
            time.sleep(3)
            st, body = req("/api/inference/overview", tok=admin_tok)
            errs = ((body or {}).get("data") or {}).get("launch_errors") or {}
            if errs.get(BOGUS):
                seen = errs
                break
        check("launch_errors 里出现了这个 uid 的失败原因", bool(seen),
              json.dumps(seen, ensure_ascii=False)[:200])
        st, _ = req("/api/inference/models", "POST", tok=admin_tok,
                    jsonbody={"model_name": "  "})
        check("空 model_name → 422，不能受理", st == 422, f"HTTP {st}")

        print("\n=== 7) autostart：没有 launch 历史的 uid 必须 409 ===")
        st, body = req(f"/api/inference/models/{BOGUS}/autostart", "PUT",
                       jsonbody={"enabled": True}, tok=admin_tok)
        check("无历史 → 409", st == 409, f"HTTP {st} {str(body)[:90]}")

        print("\n=== 7b) 活性探测：形状、与注册表交叉核对、匿名 401 ===")
        st, body = req("/api/inference/liveness", "POST", tok=admin_tok)
        live = (body or {}).get("data") or {}
        rows = {p["role"]: p for p in live.get("probes") or []}
        check("三个角色都有一条结果，且 ok/detail/latency 齐全",
              st == 200 and set(rows) == {"llm", "embedding", "rerank"}
              and all("ok" in p and "detail" in p and "latency_ms" in p for p in rows.values()),
              json.dumps({k: (v["ok"], v["latency_ms"]) for k, v in rows.items()},
                         ensure_ascii=False))
        # 探测的结论不能与注册表自相矛盾：绑的 uid 不在运行清单里却报可用，
        # 那就是又一个「看着绿、其实坏了」的面。
        st2, ov = req("/api/inference/overview", tok=admin_tok)
        running = {m.get("model_uid") or m.get("id")
                   for m in ((ov or {}).get("data") or {}).get("models") or []}
        contrad = [r for r, p in rows.items() if p["ok"] and p["model_uid"] not in running]
        check("报「可用」的模型确实都在运行清单里", not contrad, str(contrad))
        st3, _ = req("/api/inference/liveness", "POST")
        check("匿名调用 → 401（这面整面是管理员的）", st3 == 401, f"HTTP {st3}")

    finally:
        print("\n=== 8) 清场 ===")
        if admin_tok and before:
            # 兜底而不是主断言：第 3 条里已经还原过一次并查过返回码。
            # 中途抛异常时这里才是唯一保证「不把人家的绑定留在探针值上」的地方。
            st, body = req("/api/inference/bindings", tok=admin_tok)
            now = {r["role"]: r["model_uid"]
                   for r in ((body or {}).get("data") or {}).get("roles") or []}
            if now != before:
                req("/api/inference/bindings/rerank", "PUT",
                    jsonbody={"model_uid": before["rerank"], "model_name": before["rerank"]},
                    tok=admin_tok)
            st, body = req("/api/inference/bindings", tok=admin_tok)
            now = {r["role"]: r["model_uid"]
                   for r in ((body or {}).get("data") or {}).get("roles") or []}
            check("退出时三个绑定都在原值", now == before,
                  json.dumps(now, ensure_ascii=False))
        if uid is not None:
            if admin_tok:
                st, _ = req("/api/user/delete?user_id=" + str(uid), "DELETE", tok=admin_tok)
                check("一次性账号已删", st == 200, f"HTTP {st}")
            async with engine.begin() as c:
                left = [r[0] for r in await c.execute(
                    text('select count(*) from "user" where name like :p'),
                    {"p": "qa-inf-%"})][0]
            if left:
                print(f"  ! 还剩 {left} 个 qa-inf-* 账号（删号接口没成功）。"
                      f"用管理员令牌跑：DELETE /api/user/delete?user_id=<id>，"
                      f"别直接删行 —— 会话与消息要跟着走级联。")
        st, _ = req("/api/inference/overview", tok=admin_tok)
        check("删完再打必须 401", st == 401, f"HTTP {st}")


def main() -> int:
    try:
        asyncio.run(run())
    except Exception as exc:  # noqa: BLE001
        print(f"✗ 门禁自己崩了：{type(exc).__name__}: {exc}")
        return 1
    if FAILS:
        print(f"\n✗ {len(FAILS)} 项没过：" + "；".join(FAILS))
        return 1
    print("\n全部通过")
    return 0


if __name__ == "__main__":
    # 少了 sys.exit 的话，这个门禁**永远返回 0**：上一版就是这样，
    # 屏幕上明明写着「✗ 2 项没过」，shell 里却是 GATE_PASS。
    # 一条不会红的检查比没有检查更糟 —— 它会让人以为红过了。
    sys.exit(main())
