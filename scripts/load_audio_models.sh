#!/bin/bash
set -euo pipefail

BACKEND_DIR="${1:-.}"

source <(grep -E '^XINFERENCE_STT_MODEL_ID=' "$BACKEND_DIR/.env" | sed 's/ //g')

STT="${XINFERENCE_STT_MODEL_ID:-}"

if [ -n "$STT" ]; then
    echo "加载 $STT ..."
    FUNASR_DISABLE_UPDATE=true uv run -- xinference launch --model-name "$STT" --model-type audio --endpoint http://127.0.0.1:9998
fi

echo "音频模型加载完成"