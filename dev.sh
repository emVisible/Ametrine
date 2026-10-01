#!/bin/bash
# 开发环境编排：tmux 里起 前端 / 数据库 / Xinference / 后端 / 浏览器探针。
#
# 与旧版的五处差别（都是会让人「以为后端坏了」的点）：
#  1) Xinference 优先用 apps/inference/.venv（独立推理环境，没有 vllm 那条 torch 硬锁），
#     没建就退回 apps/backend/.venv 并提示先跑 scripts/setup_inference_env.sh。
#     判定在 scripts/start_inference.sh 里，不在这里。
#  2) 模型没起来也照样把后端拉起来。旧版是 `wait_for_models && uvicorn`，
#     等待一失败整条命令链就断掉，backend 窗口直接空转 —— 看起来像「后端起不来」，
#     其实只是模型没就绪，而 /health、/docs、前端联调并不需要模型。
#  3) source scripts/inference_env.sh：索引/权重源的 NO_PROXY、uv 的 PATH 都在这统一处理。
#  4) xinference 窗口只有一个 pane，而且**只负责把服务起起来 + 等它真的就绪**。
#     加载模型不再是开机动作（旧版拆两半时，右边那条等待还是假的，见 wait_for_service.sh 顶部）：
#     模型改到管理台「模型推理」页加载，重启后由 xinference 自己的 autostart 登记表把它们拉回来。
#     第一次把 .env 里的三个型号搬进 autostart 是显式的：AMETRINE_BOOTSTRAP_MODELS=1。
#  5) 端口被上一轮进程占着时**明确失败**，不再让 xinference 漂到随机端口继续跑。
#  6) 这个脚本不读 .env 里的模型 id 了。等谁就绪由 `scripts/bound_models.py` 现问绑定表 ——
#     在界面里换了模型之后，开机脚本还在等旧名字，就是「界面已经换好、终端卡在等待里」。
set -uo pipefail

SESSION="dev"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_DIR="$PROJECT_DIR/scripts"

FRONTEND_DIR="$PROJECT_DIR/apps/frontend"
BACKEND_DIR="$PROJECT_DIR/apps/backend"
MILVUS_DIR="$PROJECT_DIR/apps/database"

source "$SCRIPT_DIR/inference_env.sh"

command -v tmux >/dev/null || { echo "需要安装 tmux"; exit 1; }

# 启动链依赖这几个文件，少一个就有一个 pane 是空的（症状：tmux 里一行 No such file or
# directory，看的人以为「后端起不来」）。缺就现在说清楚，别开一个半死的会话。
for f in inference_env.sh start_inference.sh wait_for_models.sh wait_for_service.sh bound_models.py; do
    [ -e "$SCRIPT_DIR/$f" ] || {
        echo "缺少 $SCRIPT_DIR/$f —— 它是启动链的一环。"
        echo "如果它在你本地存在但不在这里，说明它还没进版本库：git add scripts/$f"
        echo "（scripts/doctor.py 会列出所有这类缺口）"
        exit 1
    }
done

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
# 一个 pane 干完三件事：起服务 → 等它真的就绪 → 加载模型（scripts/start_inference.sh）。
# 以前是 split-window 成两半，右边跑「等待 + 加载」。合回来的理由不是省地方：
# 右边那条等待当时是坏的（对任何端口都秒判就绪），所以模型加载经常在服务还没起的时候
# 就开跑，而输出在另一个 pane 里，看的人只见到左边「Application startup complete」，
# 以为一切正常。现在顺序、失败、日志都在同一屏。
tmux new-window -t "$SESSION" -n "xinference"
tmux send-keys -t "$SESSION:xinference.0" \
    "bash $SCRIPT_DIR/start_inference.sh" C-m

# ── Backend ──
# 等待的目标不再从 .env 抄（见顶部第 6 条）：`wait_for_models.sh` 不带参数时自己现问绑定表。
# 等待失败照样起后端 —— 模型没就绪时推理接口会点名报 503 并说出该去哪加载，
# 而 /health、/docs、前端联调都不需要模型。
tmux new-window -t "$SESSION" -n "backend"
tmux send-keys -t "$SESSION:backend" \
    "cd $BACKEND_DIR && source .venv/bin/activate && \
     bash $SCRIPT_DIR/wait_for_models.sh || \
     echo '⚠ 模型未全部就绪，后端仍会启动；/api/chat 等推理接口会报错，其余接口正常。' && \
     uv run -- uvicorn main:app --reload --timeout-graceful-shutdown 10 --port 3000" C-m

# ── 浏览器 ──
# 每个探针都带上它真正该命中的路径：只测 TCP 的话，代理回一个 502 也算「就绪」
# （旧版就是这样，所以浏览器总是在服务起来之前就开了）。
#   3000 用 /health —— 它在应用根路径下，不在 /api 前缀里，探 /api/health 会 404。
#   9091 用 /healthz —— Milvus 的 UI 根路径不一定回 2xx。
tmux new-window -t "$SESSION" -n "browser"
tmux send-keys -t "$SESSION:browser" \
    "echo '等待服务就绪...' && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9997 180 / && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 3000 120 /health && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 8000 120 / && \
     bash $SCRIPT_DIR/wait_for_service.sh 127.0.0.1 9091 60 /healthz && \
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
