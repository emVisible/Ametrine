#!/usr/bin/env bash
# Arborist 成员的启动入口。与 dev.sh 的分工是刻意的：
#   dev.sh            给人用的开发编排 —— tmux 多窗口、装依赖、等模型、开浏览器
#   arborist-start.sh 给中控台用的产品入口 —— 只把已有的后端与前端拉到前台运行
#
# 数据层（关系库 / Redis / Milvus）不在这里拉起，也不做任何环境构建：那是本机环境的事。
# 它们缺席时 /api/arbor/status 会如实回 degraded 并点名是谁，中控台的灯因此变橙，
# 而不是「端口通了就算健康」。
#
# 退出语义：任一头掉了就整体退出。中控台看到的必须是「停了」，
# 不能是「半死不活但端口还在」。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -x "$ROOT/apps/backend/.venv/bin/uvicorn" ] || {
    echo "✘ 缺 apps/backend/.venv —— 先跑 cd apps/backend && uv sync" >&2
    exit 1
}
[ -d "$ROOT/apps/frontend/node_modules" ] || {
    echo "✘ 缺 apps/frontend/node_modules —— 先跑 cd apps/frontend && pnpm i" >&2
    exit 1
}

pids=()
shutdown() {
    # ${pids[@]+...} 是 bash 3.2（macOS 自带）在 set -u 下安全展开空数组的写法
    for pid in ${pids[@]+"${pids[@]}"}; do
        kill "$pid" 2>/dev/null || true
    done
}
trap shutdown TERM INT

( cd "$ROOT/apps/backend" && exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port 3000 ) &
pids+=($!)
# --host=127.0.0.1 不是多余的：Vite 在 macOS 上把 `localhost` 解析成 IPv6 ::1 并只监听它，
# 而中控台按 app.toml 里的 http://127.0.0.1:8000 探测 —— 不钉死 IPv4 的话灯永远不绿。
( cd "$ROOT/apps/frontend" && exec pnpm dev --host=127.0.0.1 ) &
pids+=($!)

echo "后端 :3000 / 前端 :8000 已拉起（pid ${pids[*]}），Ctrl-C 或中控台停止即整体退出"

while sleep 1; do
    # 上一轮 sleep 结束时 bash 已回收完子进程，所以这里的 kill -0 不会被僵尸骗过去
    for pid in "${pids[@]}"; do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo "✘ 子进程 $pid 已退出，停止整栈" >&2
            shutdown
            exit 1
        fi
    done
done
