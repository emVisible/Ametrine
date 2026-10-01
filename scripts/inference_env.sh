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

# Xinference 服务器地址。
#
# ⚠ 变量名不能叫 XINFERENCE_ENDPOINT —— 那是 xinference 自己保留的环境变量
#   （`xinference/constants.py:64  XINFERENCE_ENV_ENDPOINT = "XINFERENCE_ENDPOINT"`），
#   而它期望的是**带 scheme 的完整 URL**。我们以前导出的是裸主机 `127.0.0.1`，
#   于是 `xinference launch` 在 `--endpoint` 缺省时读到它，报出
#   `requests.exceptions.MissingSchema: Invalid URL '127.0.0.1/v1/cluster/auth'`
#   —— 三个模型全部加载失败，看起来像「模型装不上」，其实是我们把别人的变量名占了。
#   所以内部一律用 AMETRINE_XINFER_*，要喂给 xinference 的那个变量则给完整 URL。
AMETRINE_XINFER_HOST="${AMETRINE_XINFER_HOST:-127.0.0.1}"
AMETRINE_XINFER_PORT="${AMETRINE_XINFER_PORT:-9997}"
AMETRINE_XINFER_URL="http://${AMETRINE_XINFER_HOST}:${AMETRINE_XINFER_PORT}"
export AMETRINE_XINFER_HOST AMETRINE_XINFER_PORT AMETRINE_XINFER_URL
export XINFERENCE_ENDPOINT="$AMETRINE_XINFER_URL"

# 端口上现在是谁（"pid:prog"，没有则空）。走 ss，不依赖 lsof。
port_holder() {
    ss -ltnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p { print $NF; exit }'
}

# 本机 HTTP 探测：打印状态码（连不上/超时打印 000）。
# 三条都必须带上，否则探针会「永远成功」：
#   --noproxy '*'  环境里有 HTTP_PROXY=127.0.0.1:7897，代理会替你回答一个错误，
#                  而 `curl -s` 不看状态码时退出码是 0 —— 实测打「确定没人监听的
#                  9998」也返回 0，于是旧 wait_for_service.sh 对任何端口都秒判就绪。
#   -m 3           没有超时的话，代理挂了就永久卡住。
#   不要再 `|| echo 000`：curl 失败时 -w 已经打了 000，再兜一次会拼成 "000000"，
#                  于是 `!= "000"` 成立 → 闭端口又被判成就绪。这条是我自己写第一版时
#                  实测踩到的（9998 报「已就绪（HTTP 000000）」）。
http_code() {
    local out
    out=$(curl -s -o /dev/null --noproxy '*' -m 3 -w '%{http_code}' "$1" 2>/dev/null)
    [ -n "$out" ] || out=000
    printf '%s' "$out"
}

# 管理员口令。
#
# ⚠ 这里必须回落到 apps/backend/.env 去读，不能只看 shell 环境：
#   以前只写 `${XINFERENCE_ADMIN_USER:-}`，而这两个键从来没进过环境，
#   于是 `xinference_admin_token` 直接返回空串 ⇒ 脚本按「匿名可达」走 ⇒
#   在鉴权开着的服务器上撞 `RuntimeError: Cannot find access token, please login first!`，
#   三个模型全部加载失败，而报错长得像模型/权重问题。
#   注意这**不是**应用运行时用的密钥：应用侧是 XINFERENCE_API_KEY（只做推理），
#   这里是「加载模型」这个管理动作 —— 实测 API key 没有 launch 权限
#   （`xinference/api/oauth2/advanced/auth_service.py:551` 把 key 的 scope 限死在
#    `models:read` / `models:list`，其余一律 403 "API keys can only access model query and
#    inference endpoints"）。官方文档写「--api-key 可以 launch」在本机 3.5.0 上不成立。
_env_file="${AMETRINE_BACKEND_ENV:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/backend/.env}"

# env_from_file <KEY> —— 从 .env 取一个键（剥引号与行尾注释），取不到则空
env_from_file() {
    [ -f "$_env_file" ] || return 0
    sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"?([^\"#]*)\"?.*/\1/p" "$_env_file" | tail -1 | xargs
}

XINFERENCE_ADMIN_USER="${XINFERENCE_ADMIN_USER:-$(env_from_file XINFERENCE_ADMIN_USER)}"
XINFERENCE_ADMIN_PASSWORD="${XINFERENCE_ADMIN_PASSWORD:-$(env_from_file XINFERENCE_ADMIN_PASSWORD)}"
export XINFERENCE_ADMIN_USER XINFERENCE_ADMIN_PASSWORD

# xinference 把登录后的 token 存在 $XINFERENCE_HOME/auth/<sha256(endpoint)>
# （`deploy/cmdline.py:74 get_hash_endpoint` + `constants.py:158 XINFERENCE_AUTH_DIR`）。
# 端点字符串必须**逐字符一致**（含 scheme、无尾斜杠），否则哈希出来是另一个文件。
xinference_stored_token_path() {
    printf '%s/auth/%s' "${XINFERENCE_HOME:-$HOME/.xinference}" \
        "$(printf '%s' "$1" | sha256sum | cut -c1-64)"
}

# xinference_ensure_login <endpoint> <xinference-cli 数组名> -> 0 可继续 / 1 该停 / 2 用错
#
# 官方写法是 `xinference login -e <endpoint> --username --password`，它 POST /token 换 JWT，
# 再把 token 原样写进 $XINFERENCE_HOME/auth/<sha256(endpoint)>（`cmdline.py:1574-1597`）。
# 我们**用同一个接口自己写那个文件**，不 fork CLI，理由有两条：
#   · `--password` 是 click 的 required 选项（不会提示输入），走命令行就等于把口令挂进 ps；
#   · CLI 的退出码不可依赖，而「令牌文件出现了没有」是可以直接断言的事实。
# 为什么要专门做这一步：`launch` 只在没给 `--api-key` 时才去读这个文件
# （`cmdline.py:1093-1094`），没有它就是那句 "Cannot find access token, please login first!"。
#
# 参数顺序把 endpoint 放第一位：以前数组名在前，调用方一旦误传命令串，
# `local -n` 先抛 "invalid variable name"，下一行又因 base 为空打出「✗  没有应答」——
# 两条报错都不指向真正的原因（用错参数）。这条是实测踩出来的。
xinference_ensure_login() {
    local base=$1
    local cli_name=${2:-}
    if [ -z "$base" ]; then
        echo "用法：xinference_ensure_login <endpoint> <xinference-cli 数组名>" >&2
        return 2
    fi
    if [ -z "$cli_name" ] || ! [[ "$cli_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        echo "第二个参数必须是 bash 数组的**名字**（例如 XINV），不是命令串：[$cli_name]" >&2
        return 2
    fi
    local -n _cli=$cli_name
    local code tok jwt
    code=$(http_code "$base/v1/models")
    case "$code" in
        401 | 403) ;;                       # 服务器要凭据，继续往下
        000) echo "✗ $base 没有应答，登录无从谈起" >&2; return 1 ;;
        *) return 0 ;;                      # 匿名可读（老版本/关了鉴权），不用登录
    esac
    tok=$(xinference_stored_token_path "$base")
    if [ -s "$tok" ]; then
        echo "已有该端点的登录令牌（$tok）"
        return 0
    fi
    if [ -z "$XINFERENCE_ADMIN_USER" ] || [ -z "$XINFERENCE_ADMIN_PASSWORD" ]; then
        cat >&2 <<MSG
✗ 服务器开着鉴权（GET /v1/models → $code），但没有管理员口令。
  launch 需要用户级 JWT，API key 没有这个权限（scope 被限死在 models:read/models:list）。
  两条出路，任选其一：
    1) 在 $_env_file 里补上 XINFERENCE_ADMIN_USER / XINFERENCE_ADMIN_PASSWORD
    2) 手动登录一次（token 会存进 ~/.xinference/auth/，之后脚本自动复用）：
       ${_cli[*]} login -e $base --username <用户名> --password <口令>
  账号是谁可以查：sqlite3 ~/.xinference/auth/auth.db 'select username from users'
MSG
        return 1
    fi
    echo "服务器要凭据，用 $XINFERENCE_ADMIN_USER 登录 $base ..."
    jwt=$(xinference_admin_token "$base")
    if [ -z "$jwt" ]; then
        echo "✗ 登录没拿到 JWT（口令不对？）。重置口令的官方工具：" >&2
        echo "    ${_cli[0]}-reset-auth-password --username $XINFERENCE_ADMIN_USER" >&2
        return 1
    fi
    mkdir -p "$(dirname "$tok")" && printf '%s' "$jwt" > "$tok" && chmod 600 "$tok"
    if [ -s "$tok" ]; then
        echo "✓ 登录成功，令牌写入 $tok"
        return 0
    fi
    echo "✗ 令牌写盘失败：$tok" >&2
    return 1
}

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
    local base=$1 payload
    local code
    code=$(http_code "$base/v1/models")
    case "$code" in
        401 | 403) ;;                       # 服务器要凭据，往下走
        *) return 0 ;;                      # 2.x 匿名可读，别多此一举去登录
    esac
    # 没配口令但人已经 `xinference login` 过 —— 直接复用 CLI 存的那个 token。
    # 不这么做的话：launch 有 token（CLI 自己读文件），而这里查状态的 REST 调用没有，
    # 于是 401 → 空响应 → running_state 报「没在跑」→ 对已运行的模型重复 launch。
    if [ -z "$XINFERENCE_ADMIN_USER" ] || [ -z "$XINFERENCE_ADMIN_PASSWORD" ]; then
        local tok
        tok=$(xinference_stored_token_path "$base")
        [ -s "$tok" ] && cat "$tok"
        return 0
    fi
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
