#!/bin/bash
# 多格式这一层的完整可重跑管线：起对照实例 → 语料 → 入库 → 保真度 → 出题 → 检索指标 → 收掉实例。
#
# 为什么要一个「对照实例」而不是改 :3000 的配置：
# 默认配置是 SEMANTIC_SPLITTER=true，而语义切分**每句话请求一次 embedding**
# （实测 1,592 字符耗时 10.69 s；同一份走定长切分 <0.01 s），整本书/整份规范根本进不来。
# 把用户的服务改成 false 再测，测到的就不是他实际跑的那套；所以另起 :3010，跑完关掉。
#
# 用法（口令放在 rag-bench/ACCOUNT，单行）：
#     bash rag-bench/run_formats_pipeline.sh
set -uo pipefail
cd "$(dirname "$0")"            # rag-bench/
ROOT=$(cd .. && pwd)
PY=$ROOT/apps/backend/.venv/bin/python
PORT=${PORT:-3010}
DB=${DB:-ragbench_fast}
COLL=${COLL:-ragbench_fastfmt}
PW="$(cat ACCOUNT)"
[ -z "$PW" ] && { echo "✗ 缺 rag-bench/ACCOUNT（单行口令）" >&2; exit 1; }
export AMETRINE_BENCH_BASE="http://127.0.0.1:$PORT/api"

start_runner() {
    if ss -ltn | grep -q ":$PORT"; then
        echo "= :$PORT 已在跑（假定它就是定长切分的对照实例）"
        return 0
    fi
    echo "= 起 :$PORT（SEMANTIC_SPLITTER=false）"
    (cd "$ROOT/apps/backend" && SEMANTIC_SPLITTER=false nohup .venv/bin/python -m uvicorn main:app \
        --port "$PORT" >> ../../rag-bench/backend$PORT.out 2>&1 &)
    for _ in $(seq 1 30); do
        ss -ltn | grep -q ":$PORT" && return 0
        sleep 2
    done
    echo "✗ :$PORT 起不来，看 rag-bench/backend$PORT.out" >&2
    return 1
}

stop_runner() {
    [ "${KEEP_RUNNER:-0}" = "1" ] && { echo "= 按 KEEP_RUNNER=1 保留 :$PORT"; return 0; }
    pkill -f "uvicorn main:app --port $PORT" 2>/dev/null
    echo "= 已关掉 :$PORT"
}

start_runner || exit 1
trap stop_runner EXIT

echo "── 1/5 语料（发现缓存已在 formats-candidates.json 时不会重新联网探测）"
timeout 900 $PY -u build_formats_corpus.py; echo "   rc=$?（1 = 有格式拿不到真实原件，会写在 formats-coverage.md 里）"

echo "── 2/5 入库"
timeout 1500 $PY -u ingest.py --password "$PW" --manifest formats/MANIFEST.json \
    --database "$DB" --collection "$COLL" \
    --map-out ingest_fast_map.json --fails-out ingest_fast_fails.json \
    --skip-format epub --max-bytes 1500000 | tail -6

echo "── 3/5 保真度（参考正文由另一套解析器取，见 formats_fidelity.py 顶部）"
timeout 600 $PY -u formats_fidelity.py --password "$PW" --map ingest_fast_map.json | grep -a "^| \`"

echo "── 4/5 出题（金标取自应用真正索引到的文本）"
timeout 600 $PY -u gen_format_queries.py --password "$PW" --map ingest_fast_map.json | tail -2

echo "── 5/5 检索指标（按格式拆分）"
timeout 900 $PY -u eval_retrieval.py --password "$PW" \
    --queries formats-queries.jsonl --map ingest_fast_map.json \
    --database "$DB" --collection "$COLL" \
    --modes raw,vector --out formats-results.json --report formats-report.md | tail -6

echo
echo "产物：formats-coverage.md / formats-fidelity.md / formats-queries.md / formats-report.md"
echo "顺手验一下集合归属守卫（会真上传一篇再删，需要时看 §15.5 的说明）："
$PY -u verify_ownership_guard.py | tail -4
