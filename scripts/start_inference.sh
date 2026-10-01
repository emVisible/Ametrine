#!/usr/bin/env bash
# 一个 pane 里把 Xinference 起起来、等它真的就绪、然后把模型加载上。
#
# dev.sh 的 xinference 窗口只跑这一条。以前这里是「左 pane 起服务 + 右 pane 等待并加载」，
# 拆成两个 pane 有两个实际坏处：
#   1) 服务起没起、加载成没成，要左右来回看；关掉窗口时容易只看到其中一半的输出。
#   2) 右边那条 `wait_for_service.sh && load_models.sh` 的等待是坏的（旧实现对任何端口
#      都秒判就绪，见 wait_for_service.sh 顶部），所以它经常在服务根本没起的时候就开始加载。
# 现在顺序全在一个 pane 里，而且就绪判定要同时满足「HTTP 真的应答」+「应答的是我们刚起的这个进程」。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$ROOT/scripts"
BACKEND_DIR="$ROOT/apps/backend"
INFER_DIR="$ROOT/apps/inference"

source "$SCRIPT_DIR/inference_env.sh"

HOST="$AMETRINE_XINFER_HOST"
PORT="$AMETRINE_XINFER_PORT"
TIMEOUT="${1:-180}"

# 清掉旧的 local_* 日志：xinference-local 会往 ~/.xinference/logs 追加，
# 上一轮的 traceback 混在今天的输出里只会让人误判（排查时得先知道哪段是这次的）。
rm -rf "$HOME"/.xinference/logs/local_* 2>/dev/null

# ── 1) 端口预检 ────────────────────────────────────────────────────────────
# 端口被占时 xinference **不会报错退出**，它自己漂到一个随机端口继续跑
# （实测：9997 被上一轮的进程占着，新实例落到 55797 并照常 "Application startup complete"）。
# 而后端、加载脚本、浏览器全都指向 9997 —— 于是界面连着的是那个**上一轮的**服务，
# 新起的那个在白占 GPU。这一步把它变成一条明确的失败。
holder=$(port_holder "$PORT")
if [ -n "$holder" ]; then
    hp=$(printf '%s' "$holder" | sed -nE 's/.*pid=([0-9]+).*/\1/p')
    echo "✘ 端口 $PORT 已经被占用：$holder" >&2
    [ -n "$hp" ] && ps -o pid,lstart,etime,cmd -p "$hp" 2>/dev/null | tail -1 >&2
    cat >&2 <<MSG
  这不是「服务没起」，是**起了两个**：新实例会漂到随机端口，而所有客户端都连 $PORT，
  连到的是这个旧进程 —— 它加载的模型、它的鉴权状态，都可能不是你刚改的那套。

  两个选择：
    就用这个已经跑着的：  打开 http://localhost:8000/admin/inference 决定跑哪些模型
                          （想按 .env 里那三个旧 id 一次性播种：bash $SCRIPT_DIR/load_models.sh $BACKEND_DIR）
    换成新的：            kill ${hp:-<pid>}   然后重跑本脚本
MSG
    exit 1
fi

# ── 2) 起服务（后台跑，日志仍然打在本 pane 里）────────────────────────────
if [ -x "$INFER_DIR/.venv/bin/xinference-local" ]; then
    echo "使用独立推理环境：$INFER_DIR/.venv"
    ( cd "$INFER_DIR" && exec ./.venv/bin/xinference-local -H "$HOST" ) &
else
    echo "⚠ 未找到 $INFER_DIR/.venv/bin/xinference-local，退回 apps/backend 环境。" >&2
    echo "  建议先跑一次：bash $SCRIPT_DIR/setup_inference_env.sh" >&2
    ( cd "$BACKEND_DIR" && exec uv run -- xinference-local -H "$HOST" ) &
fi
SERVER_PID=$!

cleanup() {
    # 只有服务还活着时才补一刀；正常退出时它已经是我们的前台等待对象了
    kill -0 "$SERVER_PID" 2>/dev/null && kill "$SERVER_PID" 2>/dev/null
}
trap cleanup INT TERM EXIT

# ── 3) 就绪判定：HTTP 应答 + 应答者是我们刚起的那个进程 ────────────────────
echo "等待 xinference 就绪（pid $SERVER_PID，超时 ${TIMEOUT}s）..."
elapsed=0
ready=0
while true; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "✘ 服务进程（pid $SERVER_PID）已退出，不再干等。上面的日志就是原因。" >&2
        trap - INT TERM EXIT
        exit 1
    fi
    code=$(http_code "http://${HOST}:${PORT}/")
    if [ "$code" != "000" ] && [ "$code" -lt 500 ] 2>/dev/null; then
        h=$(port_holder "$PORT")
        case "$h" in
            *xinference*)
                ready=1
                echo "✓ xinference 已就绪（HTTP $code，监听者 $h）"
                break
                ;;
            *)
                echo "⚠ $PORT 上有应答，但应答者不是 xinference（$h）—— 继续等" >&2
                ;;
        esac
    fi
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
        echo "✘ ${TIMEOUT}s 内没等到 $HOST:$PORT 应答（最后一次 HTTP=${code:-000}）" >&2
        echo "  服务进程还活着，多半是卡在权重/索引拉取或 GPU 初始化；看上面的日志。" >&2
        trap - INT TERM EXIT
        exit 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
done

# ── 4) 鉴权状态先说清楚 ───────────────────────────────────────────────────
# xinference 3.x 默认开鉴权（本机实测 GET /v1/models → 401）。**应用侧不再需要 API key**：
# src/inference/auth.py 用 .env 的管理员口令 POST /token 换用户级 JWT，推理与管理共用它
# （实测 API key 的 scope 只有 models:read/models:list，连 launch 都做不了，见交接文档 §11.7）。
# 所以这里要检查的是「口令在不在」，而不是「key 在不在」。
code=$(http_code "$AMETRINE_XINFER_URL/v1/models")
if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    echo "ℹ 服务器开着鉴权（/v1/models → $code）。"
    if [ -n "${XINFERENCE_ADMIN_USER:-}" ] || [ -n "$(env_from_file XINFERENCE_ADMIN_USER)" ]; then
        echo "  管理口令已从 .env 读到 —— 后端会自己签 JWT，界面里也能加载模型。"
    else
        echo "⚠ apps/backend/.env 里没有 XINFERENCE_ADMIN_USER / XINFERENCE_ADMIN_PASSWORD。" >&2
        echo "  后果是具体的，不是「可能有问题」：" >&2
        echo "    · 后端每次推理都会 401（/health 只看 postgres/redis/milvus，看不出这件事）；" >&2
        echo "    · 管理台「模型推理」页的加载/卸载会失败。" >&2
        echo "  补法：把这两键写进 .env，然后在管理台点「重连凭据」（不用重启后端）。" >&2
        echo "  账号是谁、怎么查：见 docs/HANDOVER-2026-09-29.md §11.7。" >&2
    fi
fi

# ── 5) 开机到这里就结束了：加载模型**不是**这一步的职责 ────────────────────
# 为什么把它从开机流程里拿掉：模型该跑什么，现在是应用里的一个可改状态
# （管理台「模型推理」页 + inference_role_binding 表），不再是 .env 里三个要人肉同步的名字。
# 每次开机都按 .env 重放一遍 launch，等于让脚本和界面各持一份「应该跑什么」——
# 两边不一致时谁赢？以前是脚本赢，于是界面显示已换、实际还在跑旧模型。
# 重启后模型要自己回来，用的是 xinference 自己的 autostart 登记表（页面上那个开关就是它）。
if [ "$ready" = "1" ]; then
    if [ "${AMETRINE_BOOTSTRAP_MODELS:-0}" = "1" ]; then
        echo "ℹ AMETRINE_BOOTSTRAP_MODELS=1 —— 按 .env 播种一次（加载 + 登记 autostart）。"
        bash "$SCRIPT_DIR/load_models.sh" "$BACKEND_DIR"
        rc=$?
        [ "$rc" -ne 0 ] && echo "⚠ 播种没有全部成功（退出码 $rc），上面有每个模型的失败原因。" >&2
    else
        echo "✓ 服务已就绪。模型不在这个窗口里加载 —— 打开 http://localhost:8000/admin/inference"
        echo "  （换绑定的模型、看显存、决定哪些随服务器启动；首次加载会联网拉权重）"
        echo "  想按 .env 里的三个旧 id 一次性播种并登记 autostart："
        echo "      AMETRINE_BOOTSTRAP_MODELS=1 bash $SCRIPT_DIR/start_inference.sh"
    fi
    echo
    echo "── 以下继续是 xinference 自身的日志（Ctrl-C 停服务）──────────────────"
fi

# ── 6) 把服务留在前台：这个 pane 就是它的控制台 ────────────────────────────
trap - INT TERM EXIT
wait "$SERVER_PID"
