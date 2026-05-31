#!/bin/bash

SESSION_NAME="dev"
FRONTEND_WINDOW="Frontend"
FRONTEND_PATH="apps/frontend"
XINFERENCE_WINDOW="Xinference"
BACKEND_WINDOW="Backend"
BACKEND_PATH="apps/backend"
DATABASE_WINDOW="Milvus"
DATABASE_PATH="apps/database"

# 检查 tmux 是否安装
if ! command -v tmux &> /dev/null
then
    echo "tmux 未安装，请先安装 tmux。"
    exit 1
fi

# 创建 session 和 frontend 窗口
if ! tmux has-session -t $SESSION_NAME 2>/dev/null; then
    tmux new-session -d -s $SESSION_NAME -n $FRONTEND_WINDOW
else
    tmux new-window -t $SESSION_NAME -n $FRONTEND_WINDOW
fi

# Frontend
if ! command -v node &> /dev/null; then
    tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "echo '❌ Node.js 未安装，frontend 无法启动'" C-m
else
    tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "echo '✅ Node.js 已安装，frontend 正在启动...'" C-m

    if command -v nvm &> /dev/null; then
        tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "nvm use" C-m
    fi

    if [ -f "$FRONTEND_PATH/package.json" ]; then
        tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "cd $FRONTEND_PATH && yarn install" C-m
    else
        tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "echo '❌ package.json 文件不存在，无法安装依赖'" C-m
    fi

    if ! command -v yarn &> /dev/null; then
        tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "echo '❌ Yarn 未安装，frontend 无法启动'" C-m
    elif ! grep -q '"dev":' "$FRONTEND_PATH/package.json"; then
        tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "echo '❌ package.json 中没有 dev 脚本，无法启动 frontend'" C-m
    else
        tmux send-keys -t ${SESSION_NAME}:${FRONTEND_WINDOW} "yarn dev" C-m
    fi
fi

tmux new-window -t $SESSION_NAME -n $XINFERENCE_WINDOW
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.0 "cd $BACKEND_PATH" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.0 "source .venv/bin/activate" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.0 "uv run -- env XINFERENCE_MODEL_SRC=modelscope xinference-local" C-m

# Xinference
tmux split-window -h -t ${SESSION_NAME}:${XINFERENCE_WINDOW}
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "cd $BACKEND_PATH" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "source .venv/bin/activate" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "echo '⏳ 等待 xinference-local 启动完成...'" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "sleep 32" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "uv run -- xinference launch --model-name Qwen3-Instruct --model-engine Transformers --size-in-billions 1_7 --model-format pytorch" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "uv run -- xinference launch --model-name bge-m3 --model-type embedding" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "uv run -- xinference launch --model-name bge-reranker-base --model-type rerank" C-m

tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "echo '🚀 模型加载完成，关闭当前窗口...'" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.1 "exit" C-m

tmux split-window -h -t ${SESSION_NAME}:${XINFERENCE_WINDOW}
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.2 "cd $BACKEND_PATH" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.2 "source .venv/bin/activate" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.2 "sleep 16" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.2 "uv run -- env XINFERENCE_MODEL_SRC=modelscope xinference-local --port 9998" C-m

tmux split-window -h -t ${SESSION_NAME}:${XINFERENCE_WINDOW}
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.3 "echo '⏳ 等待 xinference-local 启动完成...'" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.3 "sleep 60" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.3 "uv run -- xinference launch --model-name SenseVoiceSmall-0 --model-type audio --endpoint http://127.0.0.1:9998" C-m
tmux send-keys -t ${SESSION_NAME}:${XINFERENCE_WINDOW}.3 "exit" C-m

# Backend
tmux new-window -t $SESSION_NAME -n $BACKEND_WINDOW
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW} "cd $BACKEND_PATH" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW} "source .venv/bin/activate" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW} "sleep 90" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW} "uv run -- uvicorn main:app --reload --port 3000" C-m

# Milvus
tmux new-window -t $SESSION_NAME -n $DATABASE_WINDOW
tmux send-keys -t ${SESSION_NAME}:${DATABASE_WINDOW} "echo '🚀 启动 Milvus...'" C-m
tmux send-keys -t ${SESSION_NAME}:${DATABASE_WINDOW} "cd $DATABASE_PATH" C-m
tmux send-keys -t ${SESSION_NAME}:${DATABASE_WINDOW} "sh standalone_embed.sh start" C-m
tmux send-keys -t ${SESSION_NAME}:${DATABASE_WINDOW} "echo '🚀 数据库加载完成，请打开localhost:9091/webui页面'" C-m
tmux send-keys -t ${SESSION_NAME}:${DATABASE_WINDOW} "sleep 5" C-m
tmux send-keys -t ${SESSION_NAME}:${DATABASE_WINDOW} "exit" C-m

tmux attach -t $SESSION_NAME