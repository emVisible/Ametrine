#!/bin/bash
# 开发环境编排：tmux 里起 前端 / 数据库 / Xinference / 后端 / 浏览器探针。
#
# 与旧版的三处差别（都是会让人「以为后端坏了」的点）：
#  1) Xinference 优先用 apps/inference/.venv（独立推理环境，没有 vllm 那条 torch 硬锁），
#     没建就退回 apps/backend/.venv 并提示先跑 scripts/setup_inference_env.sh。
#  2) 模型没起来也照样把后端拉起来。旧版是 `wait_for_models && uvicorn`，
#     等待一失败整条命令链就断掉，backend 窗口直接空转 —— 看起来像「后端起不来」，
#     其实只是模型没就绪，而 /health、/docs、前端联调并不需要模型。
#  3) source scripts/inference_env.sh：索引/权重源的 NO_PROXY、uv 的 PATH 都在这统一处理。
set -uo pipefail

SESSION="dev"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_DIR="$PROJECT_DIR/scripts"

FRONTEND_DIR="$PROJECT_DIR/apps/frontend"
BACKEND_DIR="$PROJECT_DIR/apps/backend"
MILVUS_DIR="$PROJECT_DIR/apps/database"
INFER_DIR="$PROJECT_DIR/apps/inference"

source "$SCRIPT_DIR/inference_env.sh"

# ── 从 .env 读模型列表 ──
read_env() {
    sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"?([^\"#]*)\"?.*/\1/p" "$BACKEND_DIR/.env" | tail -1 | xargs
}
WAIT_MODELS=()
for key in XINFERENCE_LLM_MODEL_ID XINFERENCE_EMBEDDING_MODEL_ID XINFERENCE_RERANK_MODEL_ID XINFERENCE_STT_MODEL_ID; do
    v=$(read_env "$key")
    [ -n "$v" ] && WAIT_MODELS+=("$v")
done

command -v tmux >/dev/null || { echo "需要安装 tmux"; exit 1; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' 已存在，附加中..."
    tmux attach -t "$SESSION"
    exit 0
fi

tmux new-session -d -s "$SESSION" -n "frontend"

# ── Frontend ──
tmux send-keys -t "$SESSION:frontend" \
    "cd $FRONTEND_DIR && fnm use 25 && pnpm i && pnpm dev" C-m

# ── Database ──
tmux new-window -t "$SESSION" -n "database"
tmux send-keys -t "$SESSION:database" \
    "cd $MILVUS_DIR && docker compose up -d && \
     echo 'PostgreSQL:  localhost:5432' && \
     echo 'Redis:       localhost:6379' && \
     echo 'Milvus:      localhost:19530' && \
     echo 'Milvus UI:   http://localhost:9091'" C-m

# ── Xinference ──
tmux new-window -t "$SESSION" -n "xinference"
if [ -x "$INFER_DIR/.venv/bin/xinference-local" ]; then
    XINFER_START="cd $INFER_DIR && ./.venv/bin/xinference-local -H 127.0.0.1"
    echo "Xinference 将使用独立推理环境 apps/inference/.venv"
else
    XINFER_START="cd $BACKEND_DIR && source .venv/bin/activate && uv run -- xinference-local -H 127.0.0.1"
    echo "⚠ 未找到 apps/inference/.venv，退回应用环境。"
    echo "  建议：bash scripts/setup_inference_env.sh   （独立环境，不含 vllm，可正常升级 xinference）"
fi
tmux send-keys -t "$SESSION:xinference.0" \
    "rm -rf ~/.xinference/logs/local_* && $XINFER_START" C-m

tmux split-window -h -t "$SESSION:xinference"
tmux send-keys -t "$SESSION:xinference.1" \
    "bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9997 && \
     bash $SCRIPT_DIR/load_models.sh $BACKEND_DIR" C-m

# ── Backend ──
tmux new-window -t "$SESSION" -n "backend"
tmux send-keys -t "$SESSION:backend" \
    "cd $BACKEND_DIR && source .venv/bin/activate && \
     if [ ${#WAIT_MODELS[@]} -gt 0 ]; then \
         bash $SCRIPT_DIR/wait_for_models.sh -- "${WAIT_MODELS[@]}" || \
         echo '⚠ 模型未全部就绪，后端仍会启动；/api/chat 等推理接口会报错，其余接口正常。'; \
     fi && \
     uv run -- uvicorn main:app --reload --port 3000" C-m

# ── 浏览器 ──
tmux new-window -t "$SESSION" -n "browser"
tmux send-keys -t "$SESSION:browser" \
    "echo '等待服务就绪...' && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9997 && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 3000 && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 8000 && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9091 && \
     echo '打开浏览器...' && \
     if command -v wslview &>/dev/null; then
         wslview http://localhost:9997/ui/#/running_models/LLM && \
         wslview http://localhost:3000/docs && \
         wslview http://127.0.0.1:8000/ && \
         wslview http://localhost:9091/webui/
     elif command -v xdg-open &>/dev/null; then
         xdg-open http://localhost:9997/ui/#/running_models/LLM && \
         xdg-open http://localhost:3000/docs && \
         xdg-open http://127.0.0.1:8000/ && \
         xdg-open http://localhost:9091/webui/
     else
         echo '未找到浏览器命令，请手动打开:'
     fi && \
     exit" C-m

tmux attach -t "$SESSION"
