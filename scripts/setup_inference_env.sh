#!/usr/bin/env bash
# 建立/更新 Xinference 推理环境（apps/inference/.venv），与应用环境完全隔离。
#
# 为什么要拆开：推理栈（xinference + torch + 引擎）和应用栈（fastapi/langchain/pymilvus）
# 放在同一个 venv 里时，uv 必须给两者找一个共同解；vllm 那条 torch==2.5.1 硬锁
# 让「升级 xinference」几乎总是无解。拆开后各自 lock，互不牵制。
#
# 用法：
#   bash scripts/setup_inference_env.sh            # 解析 + 安装
#   bash scripts/setup_inference_env.sh --lock-only # 只解析，验证能不能解出来（不下载）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFER_DIR="$ROOT/apps/inference"
source "$ROOT/scripts/inference_env.sh"

LOCK_ONLY=0
[ "${1:-}" = "--lock-only" ] && LOCK_ONLY=1

cd "$INFER_DIR"

echo
echo "=== 索引可达性自检 ==="
# 这一步是必须的：本机环境里的 HTTP(S)_PROXY 会让清华源返回 403，
# uv 报的是「was not found in the package registry」，看着像依赖冲突，其实是代理被拒。
# inference_env.sh 已把索引域名加进 NO_PROXY；这里再确认一次。
#
# 但「一次 403」不能当结论：实测同一台镜像站在连续探测之间会闪断（同一命令
# 先 403 后 200），拿单次结果 exit 会把一次本来能装的安装拦死。所以：
# 先重试，再退到备用索引，全都不通才报错。
host_of() { printf '%s' "$1" | sed -E 's#https?://([^/]+).*#\1#'; }
probe_index() {
    curl -sS -o /dev/null -m 25 -w '%{http_code}' "https://$1/simple/xinference/" 2>/dev/null || echo 000
}

CONFIGURED_HOST=$(host_of "$UV_DEFAULT_INDEX")
INDEX_CODE=000
for attempt in 1 2 3; do
    INDEX_CODE=$(probe_index "$CONFIGURED_HOST")
    printf '  %-32s http=%s  ← 实际使用的索引（第 %d 次）\n' "$CONFIGURED_HOST" "$INDEX_CODE" "$attempt"
    [ "$INDEX_CODE" = "200" ] && break
    sleep 2
done

if [ "$INDEX_CODE" != "200" ]; then
    # 备用索引只列「/simple/<pkg>/ 这条路径真的能 200」的：mirrors.aliyun.com
    # 对同一路径稳定 404，拿它当候选只会再浪费一次超时。
    for host in pypi.org mirror.sjtu.edu.cn; do
        code=$(probe_index "$host")
        printf '  %-32s http=%s  ← 备用探测\n' "$host" "$code"
        if [ "$code" = "200" ]; then
            export UV_DEFAULT_INDEX="https://$host/simple"
            export PIP_INDEX_URL="$UV_DEFAULT_INDEX"
            echo "  ! 配置的索引不可用，本次改用 $UV_DEFAULT_INDEX"
            INDEX_CODE=$code
            break
        fi
    done
fi

if [ "$INDEX_CODE" != "200" ]; then
    echo "  ✗ 所有索引都不可达，再往下走只会得到一句误导性的「包不存在」。" >&2
    echo "    先查代理：env | grep -i proxy" >&2
    echo "    临时绕过：env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy bash $0 $*" >&2
    exit 2
fi

echo
echo "=== 解析依赖（uv lock） ==="
if ! uv lock; then
    echo "解析失败：请把上面的报错原文贴出来，重点看是不是 vllm/torch 那条链。" >&2
    exit 1
fi

if [ "$LOCK_ONLY" = "1" ]; then
    echo
    echo "=== 解析结果：关键包版本 ==="
    uv tree --depth 1 2>/dev/null | head -20 || true
    for pkg in xinference torch vllm transformers accelerate; do
        line=$(grep -A2 "name = \"$pkg\"" uv.lock | grep -m1 '^version = ' || true)
        printf '  %-14s %s\n' "$pkg" "${line:-（不在依赖树里，符合预期）}"
    done
    echo "LOCK_ONLY_DONE"
    exit 0
fi

echo
echo "=== 安装到 apps/inference/.venv ==="
uv sync || { echo "安装失败" >&2; exit 1; }

echo
echo "=== 校验 ==="
uv run -- python -c "import xinference, torch, transformers; print('xinference', xinference.__version__); print('torch', torch.__version__, 'cuda', torch.version.cuda); print('transformers', transformers.__version__)"
# 用 uv 自己的 check：venv 里没有 pip 模块，`uv run -- pip check` 只会报
# 「No module named pip」，看着像环境坏了。
uv pip check
uv run -- xinference-local --help >/dev/null && echo "xinference-local 可执行 ✓"

# 「树里不该有 vllm」这条不能按退出码判：实测 `uv pip show vllm` 在包不存在时
# 只往 stderr 打一句 warning，退出码仍是 0 —— 那样写等于永远报绿。
VLLM_STATE=$(uv run --no-sync python -c \
    "import importlib.util; print('present' if importlib.util.find_spec('vllm') else 'absent')" 2>/dev/null)
case "$VLLM_STATE" in
    present)
        echo "⚠ 依赖树里出现了 vllm —— 说明 extras 里混进了 [all]/[vllm]，torch 会被重新钉死" >&2
        exit 1
        ;;
    absent)
        echo "✓ 依赖树里没有 vllm，torch 未被钉死，后续 xinference 可独立升级"
        ;;
    *)
        echo "? 无法判定 vllm 是否在树里（venv 里的 python 没跑出结果），不当作通过" >&2
        exit 1
        ;;
esac
echo
echo "下一步：dev.sh 会自动优先使用 apps/inference/.venv 里的 xinference-local。"
echo "SETUP_DONE"
