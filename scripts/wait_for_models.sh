#!/bin/bash
# 等待**当前绑定的**模型进入 ready。
#
# 关键修正一（旧版就错在这）：以前只 grep 模型名是否出现在 /v1/models 里。而 Xinference 会把
# 加载失败的模型也列在同一个接口里（state=error / terminated），
# 于是 dev.sh 的「等模型就绪」在模型根本没起来的情况下也会放行，
# 后端接着启动、/api/chat 500 —— 看起来像后端坏了，其实是等待条件写错了。
#
# 关键修正二（2026-09-30）：**等谁**改由绑定表现问，不再由调用方从 .env 抄进来。
# 管理台能换模型之后，.env 里那份 id 就成了旧口径 —— 界面已经换好、脚本还在等旧名字，
# 那就是「终端卡在等待里而系统其实已经指向别处」。读绑定表和读 /api/system/ready 是同一份事实。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/apps/backend"
source "$ROOT/scripts/inference_env.sh"

ENDPOINTS=()
EXPLICIT=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --endpoint) ENDPOINTS+=("$2"); shift 2 ;;
        --) shift
            # 后面剩下的都是显式目标（保留给临时手测：`wait_for_models.sh -- foo bar`）
            while [[ $# -gt 0 ]]; do EXPLICIT+=("$1"); shift; done
            break ;;
        *) echo "未知参数: $1"; exit 1 ;;
    esac
done

if [ ${#ENDPOINTS[@]} -eq 0 ]; then
    ENDPOINTS=("$AMETRINE_XINFER_URL/v1/models")
fi

# ── 目标清单：显式参数 > 绑定表 ────────────────────────────────────────────
# 数据库可能比这个脚本先起来一点点而已（docker compose 与后端窗口是并行开的），
# 所以这里重试而不是立刻失败；一直读不到就**明确报错**，
# 不静默回落到 .env —— 悄悄用旧清单等下去，正是这条修改要消除的缺陷。
TARGET_MODELS=()
if [ ${#EXPLICIT[@]} -gt 0 ]; then
    TARGET_MODELS=("${EXPLICIT[@]}")
else
    PY="$BACKEND_DIR/.venv/bin/python"
    [ -x "$PY" ] || PY="python3"
    for attempt in 1 2 3 4 5 6; do
        mapfile -t TARGET_MODELS < <("$PY" "$ROOT/scripts/bound_models.py" 2>/dev/null)
        [ ${#TARGET_MODELS[@]} -gt 0 ] && break
        sleep 5
    done
    if [ ${#TARGET_MODELS[@]} -eq 0 ]; then
        echo "✗ 读不到角色绑定（数据库没起来？）。" >&2
        echo "  这一步不猜目标该等谁 —— 静默用 .env 里的旧 id 等下去，等到的可能是个不存在的模型。" >&2
        echo "  手动指定：bash $0 -- <uid> [<uid>...]；或先跑 apps/backend/.venv/bin/python scripts/bound_models.py 看为什么失败。" >&2
        exit 1
    fi
    echo "目标来自绑定表: ${TARGET_MODELS[*]}"
fi

MAX_WAIT="${MODEL_WAIT_TIMEOUT:-900}"   # 首次加载要下权重，600s 经常不够
INTERVAL=5
ELAPSED=0

# 服务器开了鉴权（xinference 3.x 默认就是）时，不带凭证的 /v1/models 直接 401，
# 旧写法会把它读成 unreachable —— 于是要么干等到超时，要么误判「模型没起来」。
# 查询状态用 API key 就够；只有 launch 才必须要 JWT（见 load_models.sh 与 inference_env.sh）。
XIN_TOKEN=""
if [ -n "${XINFERENCE_API_KEY:-}" ]; then
    XIN_TOKEN="$XINFERENCE_API_KEY"
elif declare -f xinference_admin_token >/dev/null; then
    XIN_TOKEN=$(xinference_admin_token "$(printf '%s' "${ENDPOINTS[0]}" | sed 's#/v1/models$##')")
fi
CURL_AUTH=()
[ -n "$XIN_TOKEN" ] && CURL_AUTH=(-H "Authorization: Bearer $XIN_TOKEN")

# 对每个目标模型输出一行 "<name> <state>"
# state ∈ ready/running（已就绪）、starting/absent（还在路上）、error/terminated（已失败）、unreachable
# 2.x 从 state/status 字段取；3.x 没有这两个字段，改用「已登记进列表」= running（见 snapshot 内注释）
snapshot() {
    local body="" ep
    for ep in "${ENDPOINTS[@]}"; do
        body=$(curl -s --noproxy '*' -m 10 ${CURL_AUTH[@]+"${CURL_AUTH[@]}"} "$ep" 2>/dev/null || true)
        [ -n "$body" ] && break
    done
    printf '%s' "$body" | python3 -c '
import json, sys

want = sys.argv[1:]
raw = sys.stdin.read()
if not raw.strip():
    for name in want:
        print(name, "unreachable")
    sys.exit(0)
try:
    data = json.loads(raw).get("data", [])
except Exception:
    for name in want:
        print(name, "unreachable")
    sys.exit(0)

states = {}
for m in data:
    name = m.get("model_name") or m.get("model_uid") or ""
    # 字段名在 xinference 各版本间漂过（state / status），大小写也不统一
    st = str(m.get("state") or m.get("status") or "").lower()
    if not st:
        # xinference 3.x 的 /v1/models 条目里根本没有 state/status 字段（实测 3.5.0：
        # 键只有 id/model_name/model_engine/replica/... ）。而副本是「加载完才登记」——
        # 实测 launch 后约 3 分钟内条目不存在，出现时显存已占 11.3 GB 且能正常推理。
        # 所以在这里出现 == 就绪。若仍按空字符串判成 starting，脚本会一直干等到超时。
        st = "running"
    states.setdefault(name, st)

for name in want:
    print(name, states.get(name, "absent"))
' "${TARGET_MODELS[@]}"
}

ready_line() {
    local s="$1"
    [ "$s" = "ready" ] || [ "$s" = "running" ]
}

echo "等待模型就绪: ${TARGET_MODELS[*]}  (超时 ${MAX_WAIT}s)"
while true; do
    all_ready=true
    failed_names=""
    summary=""
    while read -r name state; do
        summary+="$name=$state "
        if ready_line "$state"; then
            continue
        fi
        case "$state" in
            error | terminated | crash | crashed)
                failed_names+="$name($state) "
                ;;
            *)
                all_ready=false
                ;;
        esac
    done < <(snapshot)

    if [ -n "$failed_names" ]; then
        echo "✗ 有模型启动失败：$failed_names" >&2
        echo "  这类失败不是「还没加载完」，而是 xinference 已经试过了。" >&2
        echo "  看 ~/.xinference/logs/ 里对应模型的 traceback；" >&2
        echo "  报 \"Model not found in the model list\" 时先怀疑引擎（本机 vllm 0.7.2 无 Qwen3）。" >&2
        exit 2
    fi

    if [ "$all_ready" = true ]; then
        echo "✓ 所有模型已就绪"
        exit 0
    fi

    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
        echo "超时：${MAX_WAIT}s 内未全部就绪，当前状态：$summary" >&2
        exit 1
    fi
    printf '已等待 %ss（%s）\n' "$ELAPSED" "$summary"
done
