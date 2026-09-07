#!/bin/bash
set -euo pipefail

HOST="${1:-127.0.0.1}"
PORT="${2:-9997}"
TIMEOUT="${3:-180}"

echo "等待 $HOST:$PORT ..."
elapsed=0
while ! curl -s "http://$HOST:$PORT" >/dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
        echo "超时: $HOST:$PORT 在 ${TIMEOUT}s 内未就绪"
        exit 1
    fi
done
echo "$HOST:$PORT 已就绪"