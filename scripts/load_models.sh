#!/bin/bash
set -euo pipefail

BACKEND_DIR="${1:-.}"

source <(grep -E '^XINFERENCE_(LLM|EMBEDDING|RERANK)_MODEL_ID=|^XINFERENCE_LLM_SIZE=' "$BACKEND_DIR/.env" | sed 's/ //g')

LLM="${XINFERENCE_LLM_MODEL_ID:-}"
EMBEDDING="${XINFERENCE_EMBEDDING_MODEL_ID:-}"
RERANK="${XINFERENCE_RERANK_MODEL_ID:-}"
LLM_SIZE="${XINFERENCE_LLM_SIZE:-4}"

echo "加载模型: LLM=$LLM (${LLM_SIZE}B), EMBEDDING=$EMBEDDING, RERANK=$RERANK"

if [ -n "$LLM" ]; then
    echo "加载 $LLM ..."
    uv run -- xinference launch --model-name "$LLM" --model-engine Transformers \
        --size-in-billions "$LLM_SIZE" --model-format pytorch
fi

if [ -n "$EMBEDDING" ]; then
    echo "加载 $EMBEDDING ..."
    uv run -- xinference launch --model-name "$EMBEDDING" --model-type embedding
fi

if [ -n "$RERANK" ]; then
    echo "加载 $RERANK ..."
    uv run -- xinference launch --model-name "$RERANK" --model-type rerank
fi

echo "主实例模型加载完成"