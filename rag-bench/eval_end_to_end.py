#!/usr/bin/env python
"""端到端 RAG 问答基准：检索到之后，模型**用没用好**。

分三层测才有意义（前两层已由 eval_retrieval.py 量过）：
  1. 召回（raw）——该找的文档在不在候选里
  2. 排序/阈值（pipeline）——它有没有被送进 prompt
  3. **使用**（这里）——进了 prompt 之后，答案里有没有那句话、引用指没指对文档

指标：
  · 引用命中率：返回的引用 title（= 上传文件名）是否覆盖金标
  · 答案含证据：金标片段（answer_span）是否出现在回答里（对 unique/hand 类可判）
  · 无据回答率：金标没进引用却仍然作答 —— 这是最危险的一种（看起来很自信，其实是编）
  · 不可回答样本的拒答率
  · 空回答 / 流内错误分开计数：HTTP 200 但零 token 是推理侧故障，不是「答不上来」
  · 首字延迟 / 总延迟

用法：
    apps/backend/.venv/bin/python -u rag-bench/eval_end_to_end.py --password '...' --n 24
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path, PurePath

ROOT = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:3000/api"
DB = "ragbench2026"
COLL = "ragbench_all"


def login(user: str, pw: str) -> str:
    d = urllib.parse.urlencode({"username": user, "password": pw}).encode()
    r = urllib.request.Request(BASE + "/auth", data=d, method="POST",
                               headers={"Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(urllib.request.urlopen(r, timeout=20).read())["access_token"]


def ask(tok: str, prompt: str, rerank: bool, top_k: int) -> dict:
    """打一发 /api/llm/rag，收 SSE。返回 {answer, refs, ttft, total, events, stream_error}"""
    body = {"prompt": prompt, "collection_name": COLL, "database_name": DB,
            "top_k": top_k, "rerank": rerank, "stream": True}
    req = urllib.request.Request(
        BASE + "/llm/rag", data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + tok})
    t0 = time.perf_counter()
    ttft = None
    chunks: list[str] = []
    refs: list[dict] = []
    others: list[dict] = []
    stream_error: str | None = None
    try:
        with urllib.request.urlopen(req, timeout=420) as resp:
            for raw in resp:
                # 后端可能是 SSE 帧（`data: {...}`）也可能是 NDJSON 行；
                # 而内容分片本身是**一个 JSON 字符串**（`"Kubernetes"`），不是对象。
                # 只按"data:+对象"解会把整段回答读成空 —— 第一版就是这么把 6 条全判成 0 的。
                line = raw.decode("utf-8", "replace").strip()
                if not line or line.startswith(":"):
                    continue
                payload = line[5:].strip() if line.startswith("data:") else line
                if payload in ("", "[DONE]"):
                    continue
                try:
                    obj = json.loads(payload)
                except Exception:  # noqa: BLE001
                    continue
                if isinstance(obj, str):
                    if obj:
                        if ttft is None:
                            ttft = time.perf_counter() - t0
                        chunks.append(obj)
                    continue
                if not isinstance(obj, dict):
                    others.append({"shape": str(obj)[:60]})
                    continue
                # 流内错误事件：后端在模型中途停止工作时会发出这一行然后正常收尾。
                # 不接住它，就会把「模型死了」记成「这道题答案为空」。
                if isinstance(obj.get("error"), str):
                    stream_error = obj["error"]
                    continue
                # 引用可能出现在任意带 doc/title 键的事件里；不猜名字，按形状收
                if "references" in obj or "refs" in obj:
                    refs.extend(obj.get("references") or obj.get("refs") or [])
                elif obj.get("doc_id") or obj.get("document_title"):
                    refs.append(obj)
                else:
                    others.append({k: obj[k] for k in list(obj)[:4]})
                piece = obj.get("content") or obj.get("text") or obj.get("delta")
                if isinstance(piece, str) and piece:
                    if ttft is None:
                        ttft = time.perf_counter() - t0
                    chunks.append(piece)
            sid = resp.headers.get("X-Session-ID")
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read()[:160].decode('utf-8','replace')}",
                "answer": "", "refs": [], "ttft": None, "total": time.perf_counter() - t0,
                "others": [], "stream_error": None}
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}", "answer": "", "refs": [],
                "ttft": None, "total": time.perf_counter() - t0,
                "others": [], "stream_error": None}
    # 引用不在流里：控制器把它按 `X-Session-ID` 存进 Redis（600 秒 TTL），
    # 前端是流结束后再打 `GET /api/llm/references?session_id=` 取回的。
    # 不在这里跟着取一次，就会把「有引用」测成「零引用」，进而把每条都误判成无据作答。
    if sid:
        try:
            rq = urllib.request.Request(
                BASE + f"/llm/references?session_id={urllib.parse.quote(sid)}",
                headers={"Authorization": "Bearer " + tok})
            got = json.loads(urllib.request.urlopen(rq, timeout=30).read())
            # 服务端多数响应带 `{code,message,data}` 信封，这条有时又是裸数组。
            # 不拆信封就会把 dict 当 list 用：`gold_in_refs` 全判 False，
            # 「引用命中率」于是变成一个假的 0。
            if isinstance(got, dict):
                got = got.get("data") or got.get("references") or []
            refs = [x for x in got if isinstance(x, dict)] if isinstance(got, list) else []
        except Exception:  # noqa: BLE001
            refs = []
    return {"answer": "".join(chunks), "refs": refs, "ttft": ttft,
            "total": time.perf_counter() - t0, "others": others[:3],
            "stream_error": stream_error, "session_id": sid}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", required=True)
    ap.add_argument("--user", default="ragbench")
    ap.add_argument("--n", type=int, default=24)
    ap.add_argument("--rerank", action="store_true",
                    help="开重排（需要 rerank 模型在线；本机当前因 venv 不兼容起不来）")
    ap.add_argument("--top-k", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    tok = login(args.user, args.password)

    # 金丝雀：先确认推理侧真的在产出内容。
    # 这一条不是保险起见 —— 上一轮 26 条里有 16 条是「HTTP 200 + 零 token」，
    # 全部指标因此被读成「模型答不上来」，而真因是 gemma worker 的 CUDA sticky error。
    canary = ask(tok, "用一句话回答：1 加 1 等于几？", False, 1)
    if not canary["answer"].strip():
        print(f"金丝雀就没拿到内容（stream_error={canary.get('stream_error')} "
              f"error={canary.get('error')}）—— 推理侧不可用，这一轮没有意义。")
        print("先把 LLM 重新加载（/admin/inference 或 scripts/load_models.sh）再跑。")
        return 2
    print(f"金丝雀通过：{canary['answer'].strip()[:40]!r} / {canary['total']:.1f}s")

    queries = [json.loads(l) for l in (ROOT / "queries.jsonl").read_text(encoding="utf-8").splitlines()
               if l.strip()]
    mp = json.loads((ROOT / "ingest_map.json").read_text(encoding="utf-8"))
    rng = random.Random(args.seed)
    # 分层抽样：每个领域取几条，避免全落在 RFC 上（前 24 条按 id 顺序正好偏 protocol）
    by_domain: dict[str, list[dict]] = {}
    for q in queries:
        if q["kind"] == "multi":
            continue
        by_domain.setdefault(q["domain"], []).append(q)
    sample = []
    per = -(-args.n // max(1, len(by_domain)))  # 上取整：下取整会让 24 实际只跑 13 条
    for _dom, lst in sorted(by_domain.items()):
        sample.extend(rng.sample(lst, min(per, len(lst))))
    if len(sample) < args.n:
        # 分层数比 n 还多时（域外/不可回答这些层各只有几条），每层一条也凑不满 n。
        # 从剩余池里随机补齐 —— 样本量是指标的置信度来源，不能悄悄缩水。
        chosen = {q["id"] for q in sample}
        pool = [q for q in queries if q["kind"] != "multi" and q["id"] not in chosen]
        rng.shuffle(pool)
        sample.extend(pool[: args.n - len(sample)])
    sample = sample[:args.n]
    print(f"端到端样本 {len(sample)} 条，rerank={'开' if args.rerank else '关'}，top_k={args.top_k}")

    rows = []
    for i, q in enumerate(sample, 1):
        # 引用条目里可比对的只有 title（= 上传时的**文件名**）与 source 路径：
        # 1) /api/llm/references 回的对象没有 doc_id —— 第一版拿 doc_id 比，
        #    355 条全判成「引用没指对文档」，那是个假结论；
        # 2) ingest_map 里的 `title` 是抓下来的 H1（"持久卷"），服务端存的 `title`
        #    是 safe_filename（"k8s-pv-zh.md"）。拿前者当金标名同样永远不匹配 ——
        #    同一个「两处名字来源」的坑，这轮轮到评测脚本自己踩。
        # 所以金标名从 `path` 的 basename 推，再用 source 里的 doc_id 段兜一次。
        gold_names = {mp[g]["title"] for g in q["gold"] if g in mp}
        gold_names |= {PurePath(mp[g]["path"]).name for g in q["gold"] if g in mp}
        gold_ids = {str(mp[g]["doc_id"]) for g in q["gold"] if g in mp}
        r = ask(tok, q["query"], args.rerank, args.top_k)
        ref_names: set[str] = set()
        ref_ids: set[str] = set()
        ref_srcs: list[str] = []
        for x in r["refs"]:
            if not isinstance(x, dict):
                continue
            # `/llm/references` 现在回 `id`（= document 主键）。有了它就不必再靠文件名猜，
            # 所以按 id 的那一份单独收着，命中的判据也优先用它。
            for field in ("doc_id", "id", "document_id"):
                if x.get(field):
                    ref_ids.add(str(x[field]))
            for field in ("title", "document_title", "name"):
                if x.get(field):
                    ref_names.add(str(x[field]))
            src = x.get("source")
            if isinstance(src, str):
                ref_names.add(PurePath(src).name)
                ref_srcs.append(src)
        # 服务端把文件存成 `<doc_id>-<上传名>`，所以 doc_id 是 source 里的一段，
        # 不是一个路径分量 —— 按分量比会漏。
        hit_by_id = bool(gold_ids & ref_ids) or any(
            gid in s for gid in gold_ids for s in ref_srcs)
        hit_by_name = bool(gold_names & ref_names)
        hit = hit_by_id or hit_by_name
        matched_by = "id" if hit_by_id else ("name" if hit_by_name else None)
        ans = r["answer"]
        span = q.get("answer_span") or ""
        row = {
            "qid": q["id"], "kind": q["kind"], "domain": q["domain"], "lang": q["lang"],
            "query": q["query"], "error": r.get("error"),
            "stream_error": r.get("stream_error"),
            "empty_answer": (not ans.strip()) and not r.get("error"),
            "ref_count": len(r["refs"]),
            # 命中是按 id 还是只按文件名对上的：id 是精确的，name 只是兜底。
            "ref_matched_by": matched_by,
            "answer_chars": len(ans),
            "gold_in_refs": (None if not gold_names else hit),
            # 系统的 RAG 提示要求模型用「[来源：n@m]」标注出处。有引用却没标注，
            # 说明依据没被用上；没引用却标注了，说明它在编出处。
            "has_source_marker": None if not ans.strip() else bool(
                re.search(r"[【\[]\s*(来源|依据|source)", ans, re.I)),
            "span_in_answer": (None if not span or q["kind"] == "unanswerable"
                               else span.lower() in ans.lower()),
            # 「答案里出现了金标片段」这条指标自己有个坑：unique 类的题面就含着那个片段
            # （"In which context is X mentioned…"），所以命中很可能只是把问题复述了一遍。
            # 把它显式记下来，汇总时才看得见这条指标被污染了多少。
            "span_in_query": bool(span) and span.lower() in q["query"].lower(),
            "answered_without_evidence": (
                None if not gold_names
                else bool(ans.strip()) and not hit and q["kind"] != "unanswerable"),
            # 空回答**不算拒答**。上一版把 `(not ans.strip())` 当成拒答的一种，
            # 于是模型死掉时「不可回答题的正确拒答率」反而测出 1.0 ——
            # 一个把故障读成满分的指标比没有指标更糟。
            "refused": (None if q["kind"] != "unanswerable"
                        else bool(ans.strip()) and (
                            ("没有" in ans) or ("无法" in ans) or ("未找到" in ans)
                            or ("不在" in ans) or ("抱歉" in ans)
                            or bool(re.search(r"(cannot|can't|not (find|available)|no (information|mention))",
                                              ans, re.I)))),
            "ttft_s": round(r["ttft"], 2) if r["ttft"] else None,
            "total_s": round(r["total"], 2),
        }
        rows.append(row)
        # 每行落一次盘：一条查询 10~30 秒，一轮要十几分钟。
        # 只在结尾写的话，中途任何打断都会让整轮的观测全部丢掉。
        (ROOT / "e2e.json").write_text(
            json.dumps({"summary": {"n": len(rows), "in_progress": True}, "rows": rows},
                      ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  [{i}/{len(sample)}] {q['id']} {q['kind']:<12} 引用{row['ref_count']} "
              f"金标在引用={row['gold_in_refs']} 证据进答案={row['span_in_answer']} "
              f"{row['total_s']}s"
              + (" 空回答" if row["empty_answer"] else "")
              + (f" 流错误={row['stream_error'][:40]}" if row["stream_error"] else "")
              + (f" 错误={row['error'][:60]}" if row["error"] else ""))
        if i == 1:
            print("    首事件形状:", json.dumps(r["others"], ensure_ascii=False)[:220])
            print("    引用样例:", json.dumps(r["refs"][:1], ensure_ascii=False)[:220])

    def rate(key, only=None):
        src = rows if only is None else [r for r in rows if only(r)]
        vals = [r[key] for r in src if r.get(key) is not None]
        return (round(sum(1 for v in vals if v) / len(vals), 3), len(vals)) if vals else (None, 0)

    unconfounded = lambda r: r.get("span_in_answer") is not None and not r["span_in_query"]

    # 「成功的一轮」= 拿到了内容。HTTP 200 但零 token 不能算成功：
    # 那正是上一轮把 16 条读成「模型答不上来」的地方。
    ok = [r for r in rows if not r["error"] and not r["empty_answer"]]
    summary = {
        "n": len(rows), "n_ok": len(ok), "n_error": len(rows) - len(ok),
        "n_empty_answer": sum(1 for r in rows if r["empty_answer"]),
        "n_stream_error": sum(1 for r in rows if r["stream_error"]),
        "引用含金标": rate("gold_in_refs"),
        "有引用且标了出处": rate("has_source_marker"),
        "答案含证据片段": rate("span_in_answer"),
        "答案含证据片段(题面未含该片段)": rate("span_in_answer", only=unconfounded),
        "题面已含片段(该条指标失真)": sum(1 for r in rows if r.get("span_in_query")),
        "无据仍作答": rate("answered_without_evidence"),
        "不可回答时正确拒答": rate("refused"),
        "首字延迟中位_s": (round(statistics.median([r["ttft_s"] for r in ok if r["ttft_s"]]), 2)
                       if any(r["ttft_s"] for r in ok) else None),
        "总延迟中位_s": round(statistics.median([r["total_s"] for r in ok]), 2) if ok else None,
        "rerank": args.rerank, "top_k": args.top_k,
    }
    (ROOT / "e2e.json").write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    print("\n汇总:", json.dumps(summary, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
