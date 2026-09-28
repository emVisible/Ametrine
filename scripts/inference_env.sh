#!/usr/bin/env bash
# scripts/inference_env.sh —— 推理侧与包索引相关的环境约定，被 dev.sh / load_models.sh /
# setup_inference_env.sh 共同 source。这里集中处理三件在本机踩过坑的事：
#
# 1) 代理会污染包索引请求。本机 WSL 环境里 HTTP(S)_PROXY=127.0.0.1:7897，
#    走这个代理时 https://pypi.tuna.tsinghua.edu.cn/simple/... 返回 **403**，
#    uv 于是报「xinference was not found in the package registry / unsatisfiable」，
#    看起来完全像依赖冲突，实际是代理被镜像站拒绝。绕开代理后同一请求 200，
#    `uv pip compile` 能正常解析出 xinference==3.5.0（实测见 docs/refactor 那篇依赖分析）。
#    pypi.org 走这个代理还会 TLS 断流（error:0A000126 unexpected eof）。
# 2) 权重下载源：HuggingFace 直连不通，hf-mirror 与 modelscope 可达；
#    XINFERENCE_MODEL_SRC=modelscope 由 dev.sh 传入，这里再补一个 HF_ENDPOINT 兜底。
# 3) 不要把镜像站的域名留在 NO_PROXY 之外：curl/pip/uv/modelscope 都读这套变量。

# 绕开代理的主机：包索引 + 权重源 + 本机服务
AMETRINE_NO_PROXY_HOSTS="localhost,127.0.0.1,::1,pypi.tuna.tsinghua.edu.cn,pypi.org,files.pythonhosted.org,mirrors.aliyun.com,mirror.sjtu.edu.cn,hf-mirror.com,huggingface.co,www.modelscope.cn,modelscope.cn,192.168.*,172.16.*,172.17.*,172.18.*,172.19.*,172.2[0-9].*,172.3[01].*"

export NO_PROXY="${NO_PROXY:+$NO_PROXY,}$AMETRINE_NO_PROXY_HOSTS"
export no_proxy="$NO_PROXY"

# 包索引：默认用清华源（与 uv.lock 里已锁定的下载 URL 同源，命中缓存最快）
export UV_DEFAULT_INDEX="${UV_DEFAULT_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple}"
export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"

# 权重源：modelscope 优先（dev.sh 原本就是这么设的），HF 走镜像兜底
export XINFERENCE_MODEL_SRC="${XINFERENCE_MODEL_SRC:-modelscope}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-0}"

# uv 不在非登录 shell 的 PATH 上（~/.local/bin），不补这一句脚本会报 uv: command not found
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac

# Xinference 服务器地址：加载模型与等待脚本都从这里取
XINFERENCE_ENDPOINT="${XINFERENCE_ENDPOINT:-127.0.0.1}"
XINFERENCE_PORT="${XINFERENCE_PORT:-9997}"
export XINFERENCE_ENDPOINT XINFERENCE_PORT

# 管理员口令（只在 3.x 那种强制鉴权的服务器上需要；2.x 留空即可，脚本按匿名走）。
# 注意这不是应用运行时用的密钥：应用侧用的是 XINFERENCE_API_KEY（推理），
# 这里是为了「加载模型」这个管理动作 —— 实测 API key 没有 launch 权限。
XINFERENCE_ADMIN_USER="${XINFERENCE_ADMIN_USER:-}"
XINFERENCE_ADMIN_PASSWORD="${XINFERENCE_ADMIN_PASSWORD:-}"

# xinference_admin_token <base_url> -> 打印 JWT（无需鉴权/没配口令时打印空）
#
# 为什么必须是「登录换 JWT」而不是直接塞 API key —— 两条都在本机 3.5.0 上实测过：
#   1) GET /v1/models 无凭证 -> 401（服务器一起来就强制鉴权，不是可选开关）
#   2) 用签发的 API key 调 POST /v1/models -> 403
#      "API keys can only access model query and inference endpoints"
# 所以 load_models.sh / wait_for_models.sh 这类要 launch 与查状态的脚本，
# 只能拿管理员口令去 POST /token 换 JWT。口令经环境变量的环境传参进入 json.dumps，
# 不拼进 shell 字符串，避免带引号的口令把请求体打断。
xinference_admin_token() {
    local base=$1 code payload
    [ -n "$XINFERENCE_ADMIN_USER" ] && [ -n "$XINFERENCE_ADMIN_PASSWORD" ] || return 0
    code=$(curl -s --noproxy '*' -o /dev/null -m 10 -w '%{http_code}' "$base/v1/models" 2>/dev/null || echo 000)
    case "$code" in
        401 | 403) ;;
        *) return 0 ;;   # 2.x 匿名可读，别多此一举去登录
    esac
    payload=$(XU="$XINFERENCE_ADMIN_USER" XP="$XINFERENCE_ADMIN_PASSWORD" python3 -c \
        'import json,os; print(json.dumps({"username": os.environ["XU"], "password": os.environ["XP"]}))')
    curl -s --noproxy '*' -m 10 -X POST "$base/token" \
        -H 'Content-Type: application/json' -d "$payload" 2>/dev/null |
        python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("access_token", ""))
except Exception:
    print("")'
}
