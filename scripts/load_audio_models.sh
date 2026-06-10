#!/bin/bash
set -euo pipefail

BACKEND_DIR="${1:-.}"

source <(grep -E '^XINFERENCE_STT_MODEL_ID=|^XINFERENCE_TTS_MODEL_ID=' "$BACKEND_DIR/.env" | sed 's/ //g')

STT="${XINFERENCE_STT_MODEL_ID:-}"
TTS="${XINFERENCE_TTS_MODEL_ID:-}"

# 启动 STT（语音识别）
if [ -n "$STT" ]; then
    echo "加载 STT 模型: $STT ..."
    FUNASR_DISABLE_UPDATE=true uv run -- xinference launch \
        --model-name "$STT" \
        --model-type audio \
        --endpoint http://127.0.0.1:9998
fi

# 启动 TTS（语音合成）
if [ -n "$TTS" ]; then
    echo "加载 TTS 模型: $TTS ..."
    uv run -- xinference launch \
        --model-name "$TTS" \
        --model-type audio \
        --endpoint http://127.0.0.1:9998
fi

echo "音频模型加载完成"