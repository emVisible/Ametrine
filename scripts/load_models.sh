#!/bin/bash
set -euo pipefail

BACKEND_DIR="${1:-.}"

source <(grep -E '^XINFERENCE_(LLM|EMBEDDING|RERANK|STT)_MODEL_ID=|^XINFERENCE_LLM_SIZE=' "$BACKEND_DIR/.env" | sed 's/ //g')

LLM="${XINFERENCE_LLM_MODEL_ID:-}"
EMBEDDING="${XINFERENCE_EMBEDDING_MODEL_ID:-}"
RERANK="${XINFERENCE_RERANK_MODEL_ID:-}"
STT="${XINFERENCE_STT_MODEL_ID:-}"
LLM_SIZE="${XINFERENCE_LLM_SIZE:-4}"

echo "加载模型: LLM=$LLM (${LLM_SIZE}B), EMBEDDING=$EMBEDDING, RERANK=$RERANK, STT=$STT"

# LLM
if [ -n "$LLM" ]; then
    echo "加载 $LLM ..."
    uv run -- xinference launch --model-name "$LLM" --model-engine vLLM \
        --size-in-billions "$LLM_SIZE" --model-format pytorch --max_model_len 10240
fi

# Embedding
if [ -n "$EMBEDDING" ]; then
    echo "加载 $EMBEDDING ..."
    uv run -- xinference launch --model-name "$EMBEDDING" --model-type embedding
fi

# Rerank
if [ -n "$RERANK" ]; then
    echo "加载 $RERANK ..."
    uv run -- xinference launch --model-name "$RERANK" --model-type rerank
fi

# STT — 也在 9997 上
if [ -n "$STT" ]; then
    echo "加载 STT: $STT ..."
    FUNASR_DISABLE_UPDATE=true uv run -- xinference launch \
        --model-name "$STT" --model-type audio
fi

echo "所有模型加载完成"