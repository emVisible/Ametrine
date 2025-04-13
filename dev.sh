#!/bin/bash

SESSION_NAME="dev"
FRONTEND_WINDOW="frontend"
FRONTEND_PATH="apps/frontend"
BACKEND_WINDOW="backend"
BACKEND_PATH="apps/backend"

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

# frontend 窗口逻辑
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

# 创建 backend 窗口
tmux new-window -t $SESSION_NAME -n $BACKEND_WINDOW
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.0 "conda activate ametrine" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.0 "cd $BACKEND_PATH" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.0 "echo '🚀 启动 xinference-local...'" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.0 "XINFERENCE_MODEL_SRC=modelscope xinference-local" C-m

# 在 backend 窗口中分屏（垂直）运行模型加载命令
tmux split-window -h -t ${SESSION_NAME}:${BACKEND_WINDOW}
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.1 "conda activate ametrine" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.1 "cd $BACKEND_PATH" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.1 "echo '⏳ 等待 xinference-local 启动完成...'" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.1 "sleep 20" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.1 "xinference launch --model-name qwen2.5-instruct --model-engine Transformers --size-in-billions 0_5 --model-format pytorch" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.1 "xinference launch --model-name bge-m3 --model-type embedding" C-m
tmux send-keys -t ${SESSION_NAME}:${BACKEND_WINDOW}.1 "xinference launch --model-name bge-reranker-base --model-type rerank" C-m

# 附加到 tmux 会话
tmux select-window -t ${SESSION_NAME}:${BACKEND_WINDOW}
tmux attach-session -t $SESSION_NAME
