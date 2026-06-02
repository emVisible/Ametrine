#!/bin/bash
set -euo pipefail

# 用法: wait_for_models.sh [--endpoint URL]... -- model1 model2 ...
ENDPOINTS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --endpoint) ENDPOINTS+=("$2"); shift 2 ;;
        --) shift; break ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

if [ ${#ENDPOINTS[@]} -eq 0 ]; then
    ENDPOINTS=("http://127.0.0.1:9997/v1/models" "http://127.0.0.1:9998/v1/models")
fi

TARGET_MODELS=("$@")
if [ ${#TARGET_MODELS[@]} -eq 0 ]; then
    echo "未指定目标模型"
    exit 1
fi

MAX_WAIT=600
INTERVAL=5
ELAPSED=0

check_ready() {
    local model="$1"
    for ep in "${ENDPOINTS[@]}"; do
        local resp
        resp=$(curl -s "$ep" 2>/dev/null || true)
        if echo "$resp" | grep -qE "\"(id|model_name)\"[[:space:]]*:[[:space:]]*\"$model\""; then
            return 0
        fi
    done
    return 1
}

echo "等待模型加载: ${TARGET_MODELS[*]}"
while true; do
    all_ready=true
    for model in "${TARGET_MODELS[@]}"; do
        if ! check_ready "$model"; then
            all_ready=false
            break
        fi
    done

    if $all_ready; then
        echo "所有模型已就绪"
        exit 0
    fi

    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
        echo "超时: 模型在 ${MAX_WAIT}s 内未全部就绪"
        exit 1
    fi
    echo "已等待 ${ELAPSED}s ..."
done