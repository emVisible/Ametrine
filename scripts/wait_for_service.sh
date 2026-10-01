#!/bin/bash
# 等待某个本机服务真的在 HTTP 层应答。
#
# 用法: wait_for_service.sh [HOST] [PORT] [TIMEOUT=180] [PATH=/]
#
# 为什么重写（旧版对**任何**端口都秒判就绪）：
#   旧实现是 `while ! curl -s "http://$HOST:$PORT" >/dev/null; do …`。
#   本机登录 shell 有 HTTP_PROXY=http://127.0.0.1:7897，代理会替我们回一个错误，
#   而 `curl -s` 不看状态码 ⇒ 退出码 0。实测打「确定没人监听的 9998」也是 0，
#   于是 dev.sh 的 browser 窗口在服务根本没起的情况下直接开浏览器 ——
#   用户看到的「无论是否启动都会运行」就是这一条。
#   现在：--noproxy 绕开代理 + 只认「应用真的回了 HTTP 状态码」。
#     000        连不上/超时          → 未就绪
#     >=500      多半是代理或网关回的  → 未就绪
#     2xx/3xx/4xx 进程已在服务         → 就绪（401/404 也算：那是应用层的答案）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/inference_env.sh"

HOST="${1:-127.0.0.1}"
PORT="${2:-9997}"
TIMEOUT="${3:-180}"
PATH_CHECK="${4:-/}"

URL="http://${HOST}:${PORT}${PATH_CHECK}"
echo "等待 $URL ..."

elapsed=0
last="000"
while true; do
    last=$(http_code "$URL")
    if [ "$last" != "000" ] && [ "$last" -lt 500 ] 2>/dev/null; then
        echo "✓ $HOST:$PORT 已就绪（HTTP $last）"
        exit 0
    fi
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
        echo "✗ 超时：$HOST:$PORT 在 ${TIMEOUT}s 内没有应答（最后一次 HTTP=$last）" >&2
        echo "  000=连不上；>=500 通常说明回话的是代理而不是这个服务。" >&2
        exit 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done
