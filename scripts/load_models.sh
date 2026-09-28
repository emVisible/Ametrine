#!/bin/bash
# 加载 Xinference 模型。
#
# 三个必须记住的坑（都是历史上「模型死活装不上去」的直接原因，按影响从大到小）：
#  1) 代理污染下载与索引。环境里的 HTTP(S)_PROXY 会让清华源返回 403、
#     让 pypi.org TLS 断流；权重下载同样会失败。scripts/inference_env.sh 把
#     索引域名写进 NO_PROXY，这里必须 source 它。
#     实测：apps/backend/.env 里的 HTTP_PROXY=http://192.168.128.1:7897 已经失效
#     （curl 直接 000），而 main.py 会把这两个变量塞进 os.environ，
#     于是 xinference 拉权重也走同一个死代理 —— 这才是「权重永远下不下来、
#     ~/.xinference/models 一直是空的」的原因。
#  2) 引擎。本机 vllm 0.7.2 的 115 个架构里没有任何 Qwen3，所以 --model-engine vLLM
#     报的是「Model not found in the model list」——看着像模型不存在，其实是引擎不匹配。
#  3) set -e 连坐。以前 LLM 一失败整脚本退出，embedding / rerank / STT 根本没机会加载。
#     这里逐个尝试、逐个汇报，绝不因为一个失败就丢掉后面的。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${1:-$ROOT/apps/backend}"
ENV_FILE="$BACKEND_DIR/.env"

source "$ROOT/scripts/inference_env.sh"

if [ ! -f "$ENV_FILE" ]; then
    echo "找不到 $ENV_FILE" >&2
    exit 1
fi

# 只取需要的键（值里可能带引号，统一剥掉）
read_env() {
    sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"?([^\"#]*)\"?.*/\1/p" "$ENV_FILE" | tail -1 | xargs
}

LLM=$(read_env XINFERENCE_LLM_MODEL_ID)
EMBEDDING=$(read_env XINFERENCE_EMBEDDING_MODEL_ID)
RERANK=$(read_env XINFERENCE_RERANK_MODEL_ID)
STT=$(read_env XINFERENCE_STT_MODEL_ID)
OCR=$(read_env XINFERENCE_OCR_MODEL_ID)
LLM_SIZE=$(read_env XINFERENCE_LLM_SIZE); LLM_SIZE="${LLM_SIZE:-4}"
LLM_ENGINE=$(read_env XINFERENCE_LLM_ENGINE)
# .env 里 MAX_MODEL_LEN=30000，而旧脚本硬编码 --max_model_len 10240：
# 前端按 30000 计费/截断、后端按 10240 装载，长上下文会在中途被静默吃掉。
LLM_MAX_LEN=$(read_env MAX_MODEL_LEN); LLM_MAX_LEN="${LLM_MAX_LEN:-8192}"
LLM_ENGINE="${LLM_ENGINE:-Transformers}"
LOAD_OCR="${XINFERENCE_LOAD_OCR:-false}"

# 优先用独立推理环境里的 xinference CLI；没有则退回应用环境（保持旧行为可用）
INFER_VENV="$ROOT/apps/inference/.venv"
if [ -x "$INFER_VENV/bin/xinference" ]; then
    XINV=("$INFER_VENV/bin/xinference")
    echo "使用推理环境：$INFER_VENV"
else
    XINV=(uv run --project "$ROOT/apps/inference" -- xinference)
    echo "⚠ 未找到 apps/inference/.venv，退回 uv run。" >&2
    echo "  建议先跑一次：bash scripts/setup_inference_env.sh" >&2
fi

BASE_URL="http://${XINFERENCE_ENDPOINT}:${XINFERENCE_PORT}"

# xinference 3.x 的服务器强制鉴权，而实测 API key 没有 launch 权限
# （POST /v1/models 会回 403 "API keys can only access model query and inference endpoints"），
# 所以这里必须用管理员口令换 JWT。2.x 服务器上不配口令即可，函数会返回空串按匿名走。
XIN_TOKEN=$(xinference_admin_token "$BASE_URL")
AUTH_ARGS=()
CURL_AUTH=()
if [ -n "$XIN_TOKEN" ]; then
    AUTH_ARGS=(-ak "$XIN_TOKEN")                       # xinference CLI 的 --api-key 就是 Bearer 值
    CURL_AUTH=(-H "Authorization: Bearer $XIN_TOKEN")
    echo "检测到服务器开启鉴权，已用 $XINFERENCE_ADMIN_USER 换取 JWT（用于 launch 与状态查询）"
else
    echo "未使用管理凭证（匿名可达，或没配 XINFERENCE_ADMIN_USER/XINFERENCE_ADMIN_PASSWORD）"
fi

running_state() {
    # 输出该模型当前的 state（running / failed / terminated ...），没加载则空
    curl -s --noproxy '*' -m 10 "${CURL_AUTH[@]}" "$BASE_URL/v1/models" 2>/dev/null | python3 -c '
import json, sys
name = sys.argv[1]
try:
    data = json.load(sys.stdin).get("data", [])
except Exception:
    sys.exit(0)
for m in data:
    if m.get("model_name") == name:
        st = m.get("state") or m.get("status") or ""
        # xinference 3.x 的条目里根本没有 state/status（实测 3.5.0：只有 id/model_name/
        # model_engine/replica 等键），而副本是加载完成后才登记进 /v1/models 的。
        # 不兜底的话这里恒为空 → 脚本会对已在运行的模型反复 launch。
        print(st or "running")
        break
' "$1"
}

failed=()
skipped=()

# launch <标签> <模型名> <xinference launch 参数...>
launch() {
    local label="$1" model="$2"
    shift 2

    local state
    state=$(running_state "$model")
    if [ "$state" = "running" ]; then
        echo "= $label 已在运行，跳过"
        skipped+=("$label")
        return 0
    fi

    echo "→ 加载 $label${state:+（当前状态: $state）}"
    local out
    if out=$("${XINV[@]}" launch --address "$BASE_URL" ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} "$@" 2>&1); then
        echo "✓ $label 已提交"
    else
        echo "✗ $label 失败：" >&2
        echo "$out" | sed 's/^/    /' >&2
        # 常见误报：引擎不支持该模型时 xinference 说的是 "Model not found in the model list"
        if echo "$out" | grep -qi 'not found in the model list'; then
            echo "  ↪ 这个报错通常是「当前引擎没有该模型的 model_spec」，不是模型不存在。" >&2
            echo "    核对：python -c 'from xinference.client import Client; \\" >&2
            echo "    Client(\"$BASE_URL\").query_engine_by_model_name(\"$model\", \"LLM\")'" >&2
        fi
        # 3.x 上最容易撞到的一种失败：拿 API key 去做 launch（key 只能查询与推理）
        if echo "$out" | grep -qi 'only access model query and inference'; then
            echo "  ↪ 凭证类型不对：签发的 API key 不能 launch 模型。" >&2
            echo "    请在 .env 配 XINFERENCE_ADMIN_USER / XINFERENCE_ADMIN_PASSWORD，" >&2
            echo "    本脚本会自动 POST /token 换 JWT 再提交加载。" >&2
        fi
        failed+=("$label")
    fi
}

echo "配置: LLM=$LLM (${LLM_SIZE}B, engine=$LLM_ENGINE, max_len=$LLM_MAX_LEN)"
echo "      EMBEDDING=$EMBEDDING  RERANK=$RERANK  STT=$STT  OCR=$OCR (LOAD_OCR=$LOAD_OCR)"
echo "端点: $BASE_URL"

# 配置与本地缓存对不上是「模型死活起不来」里最省事的一类原因：
# 本机实测就是这种 —— .env 写的是 Qwen3-Instruct，而 ~/.xinference/modelscope 里
# 唯一完整下载好的是 gemma-4（10.25 GB 的 model.safetensors）。
# 加载失败的模型不会出现在 /v1/models 里，于是后端每次请求都在依赖注入阶段
# 拿一句 "Model not found in the model list" 当作模型不存在。
if [ -d "$HOME/.xinference/modelscope/models" ]; then
    cached=$(find "$HOME/.xinference/modelscope/models" -maxdepth 2 -mindepth 2 -type d 2>/dev/null |
        sed 's#.*/##' | sort -u | tr '\n' ' ')
    hf_cached=$(find "$HOME/.xinference/cache" -maxdepth 3 -mindepth 2 -type d 2>/dev/null |
        sed 's#.*/##' | sort -u | tr '\n' ' ')
    echo "本地缓存目录名: modelscope=[${cached:-无}] cache=[${hf_cached:-无}]"
    for want in "$LLM" "$EMBEDDING" "$RERANK" "$STT"; do
        [ -z "$want" ] && continue
        if ! printf '%s %s' "$cached" "$hf_cached" | grep -qi -- "$want"; then
            echo "  ⚠ 配置里的「$want」在本地缓存目录名里没找到 —— 首次加载会走下载；"
            echo "    若下载早已完成过，多半是模型名与缓存目录名对不上（换了模型但没改 .env）。" >&2
        fi
    done
fi
echo

[ -n "$LLM" ] && launch "LLM $LLM" "$LLM" \
    --model-name "$LLM" --model-type LLM --model-engine "$LLM_ENGINE" \
    --size-in-billions "$LLM_SIZE" --model-format pytorch \
    --max_model_len "$LLM_MAX_LEN"

[ -n "$EMBEDDING" ] && launch "Embedding $EMBEDDING" "$EMBEDDING" \
    --model-name "$EMBEDDING" --model-type embedding

[ -n "$RERANK" ] && launch "Rerank $RERANK" "$RERANK" \
    --model-name "$RERANK" --model-type rerank

# SenseVoiceSmall 属于 audio 类型；query_engine_by_model_name 只接受
# LLM/embedding/rerank/image，所以 audio 只能这样直接 launch
[ -n "$STT" ] && FUNASR_DISABLE_UPDATE=true launch "STT $STT" "$STT" \
    --model-name "$STT" --model-type audio

# GOT-OCR2_0 过去从来没被加载过（.env 里 OCR_AGENT 用的是 Tesseract），
# 所以要显式打开开关，避免白白多下几个 GB 权重
if [ -n "$OCR" ] && [ "$LOAD_OCR" = "true" ]; then
    launch "Image $OCR" "$OCR" --model-name "$OCR" --model-type image
fi

echo
if [ ${#skipped[@]} -gt 0 ]; then
    echo "已在运行: ${skipped[*]}"
fi
if [ ${#failed[@]} -gt 0 ]; then
    echo "以下模型未加载成功: ${failed[*]}" >&2
    echo "排查顺序：" >&2
    echo "  1) 引擎是否有该模型的 model_spec：query_engine_by_model_name(name, type)" >&2
    echo "  2) 权重能否下载：NO_PROXY 是否覆盖 modelscope/hf-mirror（见 scripts/inference_env.sh）" >&2
    echo "  3) 权重是否真在盘上：XINFERENCE_MODEL_SRC=modelscope 时落在 ~/.xinference/modelscope/models/<org>/<name>/" >&2
    echo "     （不是 ~/.xinference/models —— 只看后者会误判成「下载从未成功」，我就错过一次）" >&2
    echo "  4) 显存：nvidia-smi（本机 22528 MiB 是改卡上报值，实际约 11 GB）" >&2
    exit 1
fi

echo "所有已配置的模型都已提交加载"
