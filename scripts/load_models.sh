#!/bin/bash
# 加载 Xinference 模型。
# 两处必须记住的坑（都是原脚本导致「模型死活装不上去」的直接原因）：
#  1) 引擎以前硬编码 --model-engine vLLM，而 .env 里写的是 XINFERENCE_LLM_ENGINE=Transformers。
#     本机 vllm 0.7.2 支持的 115 个架构里没有任何 Qwen3（HAS_QWEN3: False），
#     于是 xinference 解析不到可用的 model_spec，报的是
#     「Model not found in the model list, uid: Qwen3-Instruct」——看着像模型不存在，其实是引擎不匹配。
#  2) 以前是 set -e：LLM 一失败整脚本就退出，embedding / rerank / STT 根本没机会加载。
set -uo pipefail

BACKEND_DIR="${1:-.}"
ENV_FILE="$BACKEND_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "找不到 $ENV_FILE" >&2
    exit 1
fi

# 原来漏了 XINFERENCE_LLM_ENGINE，所以配置里的引擎选择从未生效
source <(grep -E '^[[:space:]]*XINFERENCE_(LLM|EMBEDDING|RERANK|STT)_MODEL_ID=|^[[:space:]]*XINFERENCE_LLM_(SIZE|ENGINE)=' "$ENV_FILE" | sed 's/ //g')

LLM="${XINFERENCE_LLM_MODEL_ID:-}"
EMBEDDING="${XINFERENCE_EMBEDDING_MODEL_ID:-}"
RERANK="${XINFERENCE_RERANK_MODEL_ID:-}"
STT="${XINFERENCE_STT_MODEL_ID:-}"
LLM_SIZE="${XINFERENCE_LLM_SIZE:-4}"
LLM_ENGINE="${XINFERENCE_LLM_ENGINE:-Transformers}"

failed=()

# launch <标签> <xinference launch 参数...>
launch() {
    local label="$1"
    shift
    echo "→ 加载 $label"
    if uv run -- xinference launch "$@"; then
        echo "✓ $label 已提交"
    else
        echo "✗ $label 失败（继续尝试其余模型）" >&2
        failed+=("$label")
    fi
}

echo "配置: LLM=$LLM (${LLM_SIZE}B, engine=$LLM_ENGINE), EMBEDDING=$EMBEDDING, RERANK=$RERANK, STT=$STT"

[ -n "$LLM" ] && launch "LLM $LLM" \
    --model-name "$LLM" --model-engine "$LLM_ENGINE" \
    --size-in-billions "$LLM_SIZE" --model-format pytorch --max_model_len 10240

[ -n "$EMBEDDING" ] && launch "Embedding $EMBEDDING" \
    --model-name "$EMBEDDING" --model-type embedding

[ -n "$RERANK" ] && launch "Rerank $RERANK" \
    --model-name "$RERANK" --model-type rerank

# STT 也在 9997 上
if [ -n "$STT" ]; then
    echo "→ 加载 STT $STT"
    if FUNASR_DISABLE_UPDATE=true uv run -- xinference launch \
        --model-name "$STT" --model-type audio; then
        echo "✓ STT $STT 已提交"
    else
        echo "✗ STT $STT 失败" >&2
        failed+=("STT $STT")
    fi
fi

if [ ${#failed[@]} -gt 0 ]; then
    echo "以下模型未加载成功: ${failed[*]}" >&2
    echo "排查顺序：1) xinference 是否有该引擎的 model_spec（client.query_engine_by_model_name）" \
        "2) 权重是否已下载（~/.xinference/cache 或 ~/.cache/modelscope）" \
        "3) 显存是否够（nvidia-smi）" >&2
    exit 1
fi

echo "所有模型加载完成"
