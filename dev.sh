#!/bin/bash
set -euo pipefail

SESSION="dev"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_DIR="$PROJECT_DIR/scripts"

FRONTEND_DIR="$PROJECT_DIR/apps/frontend"
BACKEND_DIR="$PROJECT_DIR/apps/backend"
MILVUS_DIR="$PROJECT_DIR/apps/database"

# ── 从 .env 读模型列表 ──
source <(grep -E '^XINFERENCE_(LLM|EMBEDDING|RERANK|STT)_MODEL_ID=' "$BACKEND_DIR/.env" | sed 's/ //g')
WAIT_MODELS=()
[ -n "${XINFERENCE_LLM_MODEL_ID:-}" ] && WAIT_MODELS+=("$XINFERENCE_LLM_MODEL_ID")
[ -n "${XINFERENCE_EMBEDDING_MODEL_ID:-}" ] && WAIT_MODELS+=("$XINFERENCE_EMBEDDING_MODEL_ID")
[ -n "${XINFERENCE_RERANK_MODEL_ID:-}" ] && WAIT_MODELS+=("$XINFERENCE_RERANK_MODEL_ID")
[ -n "${XINFERENCE_STT_MODEL_ID:-}" ] && WAIT_MODELS+=("$XINFERENCE_STT_MODEL_ID")

# ── 检查 tmux ──
command -v tmux >/dev/null || { echo "需要安装 tmux"; exit 1; }

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' 已存在，附加中..."
    tmux attach -t "$SESSION"
    exit 0
fi

tmux new-session -d -s "$SESSION" -n "frontend"

# ── Frontend ──
tmux send-keys -t "$SESSION:frontend" \
    "cd $FRONTEND_DIR && yarn install && yarn dev" C-m

# ── Database (PostgreSQL + Redis + Milvus) ──
tmux new-window -t "$SESSION" -n "database"
tmux send-keys -t "$SESSION:database" \
    "cd $MILVUS_DIR && docker compose up -d && \
     echo 'PostgreSQL:  localhost:5432' && \
     echo 'Redis:       localhost:6379' && \
     echo 'Milvus:      localhost:19530' && \
     echo 'Milvus UI:   http://localhost:9091'" C-m

# ── Xinference ──
tmux new-window -t "$SESSION" -n "xinference"

# pane 0: 主实例 (9997)
tmux send-keys -t "$SESSION:xinference.0" \
    "cd $BACKEND_DIR && source .venv/bin/activate && \
     rm -rf ~/.xinference/logs/local_* && \
     uv run -- env XINFERENCE_MODEL_SRC=modelscope xinference-local" C-m

# pane 1: 音频实例 (9998)
tmux split-window -h -t "$SESSION:xinference"
tmux send-keys -t "$SESSION:xinference.1" \
    "cd $BACKEND_DIR && source .venv/bin/activate && \
     rm -rf ~/.xinference/logs/local_* && \
     uv run -- env XINFERENCE_MODEL_SRC=modelscope xinference-local --port 9998" C-m

# pane 2: 等待 9997 就绪后加载主模型
tmux split-window -h -t "$SESSION:xinference"
tmux send-keys -t "$SESSION:xinference.2" \
    "cd $BACKEND_DIR && source .venv/bin/activate && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9997 && \
     bash $SCRIPT_DIR/load_models.sh $BACKEND_DIR && \
     exit" C-m

# pane 3: 等待 9998 就绪后加载音频模型
tmux split-window -h -t "$SESSION:xinference"
tmux send-keys -t "$SESSION:xinference.3" \
    "cd $BACKEND_DIR && source .venv/bin/activate && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9998 && \
     bash $SCRIPT_DIR/load_audio_models.sh $BACKEND_DIR && \
     exit" C-m

# ── Backend ──
tmux new-window -t "$SESSION" -n "backend"
tmux send-keys -t "$SESSION:backend" \
    "cd $BACKEND_DIR && source .venv/bin/activate && \
     bash $SCRIPT_DIR/wait_for_models.sh -- ${WAIT_MODELS[*]} && \
     uv run -- uvicorn main:app --reload --port 3000" C-m

# ── 浏览器 ──
tmux new-window -t "$SESSION" -n "browser"
tmux send-keys -t "$SESSION:browser" \
    "echo '等待服务就绪...' && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9997 && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9998 && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 3000 && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 8000 && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9091 && \
     echo '打开浏览器...' && \
     if command -v wslview &>/dev/null; then
         wslview http://localhost:9997/ui/#/running_models/LLM && \
         wslview http://localhost:9998/ui/#/running_models/audio && \
         wslview http://localhost:3000/docs && \
         wslview http://127.0.0.1:8000/ && \
         wslview http://localhost:9091/webui/
     elif command -v xdg-open &>/dev/null; then
         xdg-open http://localhost:9997/ui/#/running_models/LLM && \
         xdg-open http://localhost:9998/ui/#/running_models/audio && \
         xdg-open http://localhost:3000/docs && \
         xdg-open http://127.0.0.1:8000/ && \
         xdg-open http://localhost:9091/webui/
     else
         echo '未找到浏览器命令，请手动打开:' && \
         echo '  http://localhost:9997/ui/#/running_models/LLM' && \
         echo '  http://localhost:9998/ui/#/running_models/audio' && \
         echo '  http://localhost:3000/docs' && \
         echo '  http://127.0.0.1:8000/' && \
         echo '  http://localhost:9091/webui/'
     fi && \
     exit" C-m

# ── 附加 ──
tmux attach -t "$SESSION"