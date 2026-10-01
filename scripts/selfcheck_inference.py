#!/usr/bin/env python
"""推理绑定与凭据的自检（可重跑，不依赖 pytest）。

为什么写成脚本而不是单测：这个 venv 里没有 pytest，而为一条断言引入测试框架
会去动 `uv.lock`（这台机器上 `uv lock` 会重解析 360 个包，见交接文档 §6.3）。

**每条审计都配一个正样本**：只断言「它现在是绿的」不够 —— 缓存失效那类代码
写坏了也会一路绿，因为没人证明过「不失效会怎样」。
这里第 3 条就是故意**不**调失效函数，要求旧句柄确实还在，
否则第 2 条的通过可能只是巧合（比如句柄本来每次都新建）。

用法（从仓库根）：
    apps/backend/.venv/bin/python scripts/selfcheck_inference.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "apps" / "backend"
sys.path.insert(0, str(BACKEND))

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'✓' if ok else '✗'} {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILS.append(label)


async def main() -> int:
    from sqlalchemy.ext.asyncio import AsyncSession  # noqa: F401

    import src.client as app_client
    from src.client import async_session
    from src.inference import bindings

    print("=== 0) 前置：快照可用 ===")
    async with async_session() as s:
        snap = await bindings.refresh(s)
    check("表里读到了绑定", bool(snap), f"snapshot={snap}")
    # 这一条专抓「静默回落到 .env」：模块级快照没灌进去时，current() 看起来仍然是对的，
    # 但改绑定就再也不生效 —— 而 from_settings 是唯一能看出来的地方。
    roles = bindings.snapshot()["roles"]
    check("快照真的灌进了模块状态（不是靠 .env 兜底）",
          all(not r["from_settings"] for r in roles),
          f"from_settings={[r['role'] for r in roles if r['from_settings']]}")
    original = dict(snap)

    print("\n=== 1) 同一绑定应复用同一个句柄对象（否则每条请求都在重建）===")
    a = app_client.get_rerank_model()
    b = app_client.get_rerank_model()
    check("两次 get_rerank_model() 是同一对象", a is b, f"uid={a.model_uid}")

    print("\n=== 2) 改绑定 + 失效 → 句柄必须跟着换 ===")
    async with async_session() as s:
        new_snap = await bindings.set_binding(s, "rerank", "__selfcheck_other_model__")
    app_client.invalidate_model_handles()
    c = app_client.get_rerank_model()
    check("失效后拿到的是新 uid", c.model_uid == "__selfcheck_other_model__", f"uid={c.model_uid}")

    print("\n=== 3) 正样本：不失效的话，旧句柄必须还在被复用 ===")
    # 这一条是在证明第 2 条不是巧合：如果这里也拿到了新 uid，
    # 说明句柄根本没缓存，那第 2 条的「通过」就没有意义。
    d = app_client.get_rerank_model()
    check("不失效时仍是上一个 uid（缓存确实存在）", d is c and d.model_uid == "__selfcheck_other_model__",
          f"uid={d.model_uid}")
    async with async_session() as s:
        await bindings.refresh(s)
    e_before = app_client.get_rerank_model()
    check("只 refresh 不 invalidate → 句柄仍是旧的（所以两步都要做）",
          e_before.model_uid == "__selfcheck_other_model__", f"uid={e_before.model_uid}")

    print("\n=== 4) 还原：把绑定写回原值并失效 ===")
    async with async_session() as s:
        back = await bindings.set_binding(s, "rerank", original["rerank"], original["rerank"])
    app_client.invalidate_model_handles()
    f = app_client.get_rerank_model()
    check("已还原", f.model_uid == original["rerank"], f"uid={f.model_uid}")
    check("set_binding 会自己触发失效（第 2 步的失效是多余的但无害）",
          bindings.current("rerank") == original["rerank"])

    print("\n=== 5) 快照 TTL：多 worker 下别的进程最多多看 30 秒旧值 ===")
    check("刚 refresh 过 → 不旧", not bindings.stale())
    saved = bindings.STALE_AFTER_SECONDS
    bindings.STALE_AFTER_SECONDS = 0.0
    check("TTL 设成 0 → 立刻算旧", bindings.stale())
    bindings.STALE_AFTER_SECONDS = saved

    print("\n=== 6) 凭据：JWT 能拿到，且会注入共享 client（推理面靠它）===")
    from src.inference import auth

    # 先真的签一次：登录是 lifespan 里做的，自检是独立进程，不签就没得断言
    try:
        token = await asyncio.to_thread(auth.bearer)
    except Exception as exc:  # noqa: BLE001
        token = None
        print("   bearer() 抛了:", type(exc).__name__, str(exc)[:120])
    check("拿到了 JWT（或服务器压根不要求鉴权）",
          bool(token) or not auth.cluster_authed(), f"长度={len(token or '')}")
    # 共享句柄现在是惰性的（第 8 条会验「import 不碰网络」），所以这里显式要一次。
    # 这一步同时钉住另一个洞：登录发生在建句柄**之前**时，后建出来的句柄必须补上 JWT ——
    # 只在建好之后 `_set_token` 一次的话，「先登录后推理」这条顺序会让每条推理都 401。
    shared = app_client.get_client()
    check(
        "共享 RESTfulClient 带上了 Authorization（后建的句柄也补得到）",
        bool(getattr(shared, "_headers", {}).get("Authorization"))
        or not auth.cluster_authed(),
        f"headers={'有' if getattr(shared, '_headers', {}).get('Authorization') else '无'}",
    )
    st = auth.state()
    check("state() 不外泄口令", "password" not in str(st).lower() and "preview" not in str(st))

    # ── 7) 加载看门狗 ────────────────────────────────────────────────────
    # 它存在的理由：xinference 对**不存在的型号**也回 200，然后把任务永远挂在
    # {progress:0, stage:"pending", replicas:[], download_files:[]} 上（实测 60 秒 20 次采样没变过）。
    # 后台任务不抛异常 ⇒ launch_errors 为空 ⇒ 界面只能永远显示「在途加载 0%」。
    # 这组断言两头都要钉：**沉默必须报**，**有动静绝不能乱报** ——
    # 只测前一半的话，写一个「永远报错」的实现照样全绿。
    print("\n=== 7) 加载看门狗：沉默要看得见，有动静不许误报 ===")
    from src.inference import service as svc

    def probe(prog, running, window=0.5):
        """把 watch 的两个读数的来源换成假数据，只看它最后落不下落得下结论。"""
        svc._launch_errors.clear()
        saved = (svc._WATCH_SECONDS, svc._WATCH_INTERVAL,
                 svc.model_progress, svc.running_models)
        svc._WATCH_SECONDS, svc._WATCH_INTERVAL = window, 0.1
        svc.model_progress = lambda uid: dict(prog)
        svc.running_models = lambda: list(running)
        started = time.monotonic()
        try:
            svc._watch_launch("m")
        finally:
            (svc._WATCH_SECONDS, svc._WATCH_INTERVAL,
             svc.model_progress, svc.running_models) = saved
        return bool(svc._launch_errors), time.monotonic() - started

    silent = probe({"progress": 0.0, "stage": "pending", "replicas": [], "download_files": []}, [])
    check("完全沉默 → 落下一条可见的失败", silent[0] is True)
    check("  正样本：窗口没到之前它确实在等（不是立刻报错）", silent[1] >= 0.5, f"{silent[1]:.2f}s")

    for label, prog, running in (
        ("stage 已经离开 pending", {"stage": "loading"}, []),
        ("有了副本", {"stage": "pending", "replicas": [{"progress": 0.1}]}, []),
        ("开始下权重", {"stage": "pending", "download_files": [{"a": 1}]}, []),
        ("进度走了数值", {"stage": "pending", "progress": 0.4}, []),
        ("已经进了运行清单", {"stage": "pending"}, [{"model_uid": "m"}]),
    ):
        moved = probe(prog, running, window=3.0)
        # window 故意给到 3 秒：有动静就该**提前返回**，等到超时无非是把线程白占着
        check(f"{label} → 不报错", moved[0] is False)
        check(f"  且提前结束（没有白等满窗口）", moved[1] < 1.0, f"{moved[1]:.2f}s")

    print("\n=== 8) import 不许碰网络（后端必须能在推理服务之前起来）===")
    # 这条钉的是一个实测到的启动死锁：`src/client.py` 以前在模块级构造
    # `RESTfulClient(...)`，而 3.x 的构造函数会立刻打一次 `/v1/cluster/auth`。
    # dev.sh 里后端与推理服务并行起 ⇒ 那条探测拿到代理回的 502 HTML ⇒
    # 库里的 `response.json()` 抛 JSONDecodeError ⇒ **整个应用 import 阶段就死**。
    # 判据要两头都验，否则「import 成功」可能只是因为根本没走到那条构造：
    #   (a) 指向一个死掉的地址，import 仍然成功，且共享句柄还没被建出来；
    #   (b) 同一个进程里真去用它，必须失败成 XinferenceUnavailable。
    import subprocess

    dead = dict(os.environ)
    dead["PYTHONPATH"] = str(BACKEND)
    dead["XINFERENCE_MAIN_ADDR"] = "http://127.0.0.1:1"
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        dead.pop(k, None)  # 不带代理：这里要的是「连不上」，不是「代理替我回一个 502」
    py = sys.executable

    r1 = subprocess.run(
        [py, "-c", "import src.client; print(src.client.peek_client())"],
        cwd=str(BACKEND), env=dead, capture_output=True, text=True, timeout=180,
    )
    check(
        "推理服务不可达时 import 仍成功，且没有偷偷建好共享句柄",
        r1.returncode == 0 and r1.stdout.strip() == "None",
        f"rc={r1.returncode} out={r1.stdout.strip()[:60]} err={r1.stderr.strip()[-90:]}",
    )
    r2 = subprocess.run(
        [py, "-c",
         "import src.client\n"
         "from src.inference.errors import XinferenceUnavailable\n"
         "try:\n"
         "    src.client.get_client()\n"
         "    print('NO_RAISE')\n"
         "except XinferenceUnavailable:\n"
         "    print('RAISED')\n"
         "except Exception as e:\n"
         "    print('OTHER', type(e).__name__)"],
        cwd=str(BACKEND), env=dead, capture_output=True, text=True, timeout=180,
    )
    check(
        "正样本：同一个进程里真去用它必须失败（否则上一条的「成功」是空跑）",
        r2.stdout.strip() == "RAISED",
        f"out={r2.stdout.strip()[:60]} err={r2.stderr.strip()[-90:]}",
    )

    print("\n=== 9) 加载体的组装：T2 字段与 T3 透传都必须真的进到 payload 里 ===")
    # 界面那三层（设计文档 §10）如果只做到「输入框有」而没做到「服务器收到」，
    # 就又是一次「界面显示已换、实际没生效」。这条不碰服务器，只验我们自己的组装。
    from src.inference.dto import BindingBody, LaunchBody

    b = LaunchBody(
        model_name="gemma-4",
        model_type="LLM",
        model_uid="gemma-4-alt",
        model_engine="Transformers",
        size_in_billions=4,
        model_format="pytorch",
        quantization="none",
        replica=2,
        n_gpu="auto",
        max_model_len=8192,
        extra={"max_num_seqs": 32, "download_dir": "/mnt/models"},
    )
    p = b.to_launch_payload()
    check(
        "uid / 副本 / GPU / 上下文长度都在 payload 里",
        p["model_uid"] == "gemma-4-alt"
        and p["replica"] == 2
        and p["n_gpu"] == "auto"
        and p["max_model_len"] == 8192,
        json.dumps({k: p.get(k) for k in ("model_uid", "replica", "n_gpu", "max_model_len")}),
    )
    check(
        "T3 的额外键原样并入（不建模、不白名单）",
        p.get("max_num_seqs") == 32 and p.get("download_dir") == "/mnt/models",
        str({k: p.get(k) for k in ("max_num_seqs", "download_dir")}),
    )
    check(
        "wait_ready 绝不进 body（它是 query 参数，进 body 会 500）",
        "wait_ready" not in p and "autostart" not in p,
        str(sorted(p.keys())),
    )
    # 正样本：漏并 extra 的实现必须在这里红 —— 把 extra 拿掉再组一次，键应消失
    p2 = LaunchBody(model_name="m", model_type="rerank").to_launch_payload()
    check(
        "正样本：没给 extra 时那些键确实不存在（证明上一条不是恒真）",
        "max_num_seqs" not in p2 and "download_dir" not in p2,
        str(sorted(p2.keys())),
    )
    check(
        "正样本：uid 缺省回落到型号名，且保留后缀被挡",
        LaunchBody(model_name="bge-m3", model_type="embedding").to_launch_payload()["model_uid"]
        == "bge-m3",
    )
    try:
        LaunchBody(model_name="bge-m3", model_type="embedding", model_uid="bge-m3-rep0")
        check("带保留后缀的 uid 必须被拒（-rep<数字> 是服务器给副本用的）", False, "竟然通过了")
    except Exception as exc:  # noqa: BLE001
        check(
            "带保留后缀的 uid 必须被拒（-rep<数字> 是服务器给副本用的）",
            "保留后缀" in str(exc),
            str(exc)[:80],
        )
    try:
        BindingBody(model_uid="   ")
        check("空 uid 的绑定必须被拒", False, "竟然通过了")
    except Exception:  # noqa: BLE001
        check("空 uid 的绑定必须被拒", True)

    print("\n=== 10) 生成中断要收口成流内事件，不能逃出生成器 ===")
    # StreamingResponse 在第一块之前就发了 200 与响应头：异常逃出去只会留下
    # 「一个成功的空回答」。实测踩过 —— gemma worker 的 CUDA sticky error 让
    # 后续 48 次 /api/llm/rag 全是 200 + 零 token，界面是一条空白气泡。
    from src.llm.streaming import StreamGuard

    async def broken_source():
        yield '"前半句"'
        raise RuntimeError(
            "[address=127.0.0.1:44821, pid=15564] CUDA error: device-side assert triggered"
        )

    sem = asyncio.Semaphore(1)
    await sem.acquire()
    guard = StreamGuard(sem, None)
    out = [c async for c in guard.stream(broken_source())]
    tail = json.loads(out[-1]) if out else {}
    if not isinstance(tail, dict):
        # 收口失败时最后一块只是普通内容：这里要把「没有 error 事件」变成一条红勾，
        # 而不是让自检脚本崩在这里。
        tail = {}
    check("异常被收口成一条 error 事件", isinstance(tail.get("error"), str), str(tail)[:70])
    check("上游原文不外泄（ip:port 与 pid 只进日志）",
          "pid=" not in str(tail.get("error", ""))
          and "CUDA" not in str(tail.get("error", "")),
          str(tail.get("error", ""))[:60])
    check("名额随流归还（否则一路坏流永久吃掉一个并发）", not sem.locked())

    async def good_source():
        yield '"a"'
        yield '"b"'

    sem2 = asyncio.Semaphore(1)
    await sem2.acquire()
    out2 = [c async for c in StreamGuard(sem2, None).stream(good_source())]
    # 正样本：正常流里不许混进 error —— 否则上面三条可能只是「什么都报错」
    check("正样本：正常流不产生 error 事件", not any("error" in c for c in out2),
          "".join(out2)[:50])

    print()
    if FAILS:
        print(f"✗ {len(FAILS)} 条未过：" + "；".join(FAILS))
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
