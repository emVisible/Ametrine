"""xinference 的凭据生命周期。

为什么需要这个模块：xinference 3.x **默认开启** advanced auth
（`constants.py:171`：`XINFERENCE_AUTH_ADVANCED` 缺省为 true），而

* 管理面（launch / terminate / autostart）必须要**用户级 JWT**；
* API key 的 scope 被服务器限死在 `{"models:read","models:list"}`
  （`api/oauth2/advanced/auth_service.py:551`），拿它 launch 会得到 403
  "API keys can only access model query and inference endpoints"。
  —— 官方文档里「--api-key 也能 launch」那句在本机 3.5.0 上不成立，这条是实测+源码双证的。

而实测 `Authorization: Bearer <JWT>` 打 `/v1/models` 与推理端点都返回 200，
所以**一把 JWT 同时服务推理面与管理面**，`XINFERENCE_API_KEY` 不再是必需配置。

三个刻意的设计：
1. **不用 `lru_cache`**。`lru_cache` 不缓存异常，登录失败会变成「每个请求重付一次登录成本」
   —— 这台机器在分词器上就是每个请求 69 秒然后裸 500（见交接文档 §6.7）。
   这里失败进入冷却窗口，窗口内用同一个原因明确失败。
2. **401 自动重签一次并重试一次**，只一次。第二次还 401 就是真没权限，不是过期。
3. **token 会同步注入共享的 `RESTfulClient`**。实测 `Client.get_model()` 把
   `self._headers` 这个**同一个 dict 对象**交给每个模型句柄
   （`restful_client.py:1646-1658`），所以 `_set_token()` 改一处，
   已经创建出来的句柄也跟着生效 —— 不需要为了换 token 去重建句柄。
"""

from __future__ import annotations

import base64
import binascii
import json
import threading
import time
from typing import Any, Dict, Optional, Tuple

import httpx

from src.config import (
    xinference_addr,
    xinference_admin_password,
    xinference_admin_user,
)
from .errors import XinferenceUnavailable

# 提前多少秒判定「该续了」：避免卡在过期边界上，让用户的请求去撞那一下 401。
_REFRESH_SKEW_SECONDS = 120
# 登录失败后的冷却。设短一点是因为「管理员把口令改对了」应该很快生效。
_FAILURE_COOLDOWN_SECONDS = 60

_lock = threading.Lock()
_token: Optional[str] = None
_token_exp: float = 0.0
_failed_until: float = 0.0
_last_error: str = ""
_authed: Optional[bool] = None  # None = 还没探过；服务器可能压根没开鉴权


def _base_url() -> str:
    return (xinference_addr or "").rstrip("/")


def _decode_exp(token: str) -> float:
    """从 JWT 里读 exp（秒）。**不校验签名**：这只用于决定「要不要提前重签」，
    安全性由服务器自己判，读错最多让我们多签一次。"""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
        return float(data.get("exp", 0))
    except (IndexError, ValueError, binascii.Error, AttributeError):
        return 0.0


def _apply_to_shared_client(token: Optional[str]) -> None:
    """把 token 交给 `src.client` 的共享句柄（推理面走的就是它）。

    延迟导入是为了打断循环：`src.client` 要用 `bindings.current()`，
    而这里要用 `src.client` 里那个共享句柄。模块级互相 import 会当场炸。

    **这里不再 `except: pass`**。以前那句吞异常让「导入被改名弄断」这种代码级错误
    表现为「凭据明明签到了、每条推理还是 401」，而管理页还显示「凭据已带上」——
    一个凭据模块最不该犯的就是这种错。现在失败往上抛，由 `_login` 翻成一条明确的可读错误。
    """
    from src.client import set_shared_token  # noqa: PLC0415

    set_shared_token(token)


def cluster_authed() -> bool:
    """服务器是否开了鉴权。探不到时按「没开」处理，让调用方去撞真实的 401。

    **只有拿到确定答案（HTTP 200）才写缓存**。以前任何一次响应都会写死 `_authed`，
    而后端与推理服务是并行起来的 —— 启动那一瞬代理替我们回一个 502 HTML，
    就会被永久记成「这台服务器没开鉴权」：于是每条调用都不带凭据出去、全部 401，
    而界面写着「服务器未开鉴权」。那是把一个瞬时故障缓存成了永久事实。
    """
    global _authed
    with _lock:
        if _authed is None:
            try:
                r = httpx.get(f"{_base_url()}/v1/cluster/auth", timeout=5.0)
            except Exception:  # noqa: BLE001
                return False
            if r.status_code == 200:
                _authed = bool(r.json().get("auth"))
            else:
                # 没拿到答案就不下结论：这次按「不要求鉴权」走，下次再探
                return False
        return _authed


def _login_locked() -> str:
    """拿管理员口令换 JWT。调用方必须持有 _lock。"""
    global _token, _token_exp, _failed_until, _last_error
    if not xinference_admin_user or not xinference_admin_password:
        _failed_until = time.monotonic() + _FAILURE_COOLDOWN_SECONDS
        _last_error = "missing_credentials"
        raise XinferenceUnavailable(
            "xinference 开着鉴权，但 .env 里没有 XINFERENCE_ADMIN_USER / "
            "XINFERENCE_ADMIN_PASSWORD。加载与卸载模型都需要用户级凭据"
            "（API key 没有 launch 权限）。",
            retry_after=_FAILURE_COOLDOWN_SECONDS,
        )
    try:
        r = httpx.post(
            f"{_base_url()}/token",
            json={"username": xinference_admin_user, "password": xinference_admin_password},
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        _failed_until = time.monotonic() + _FAILURE_COOLDOWN_SECONDS
        _last_error = type(exc).__name__
        raise XinferenceUnavailable(
            f"连不上 xinference 的登录接口（{_last_error}），详情见 ametrine.log。",
            retry_after=_FAILURE_COOLDOWN_SECONDS,
        ) from exc

    if r.status_code != 200:
        _failed_until = time.monotonic() + _FAILURE_COOLDOWN_SECONDS
        # 只记状态码与错误类型，不把响应体里的内容往外带（可能含用户名提示）
        _last_error = f"login_{r.status_code}"
        raise XinferenceUnavailable(
            f"xinference 登录被拒（HTTP {r.status_code}）。"
            "口令不对或账号被停用；重置口令用 "
            "`xinference-reset-auth-password --username <用户名>`。",
            retry_after=_FAILURE_COOLDOWN_SECONDS,
        )
    token = (r.json() or {}).get("access_token") or ""
    if not token:
        _failed_until = time.monotonic() + _FAILURE_COOLDOWN_SECONDS
        _last_error = "login_no_token_in_response"
        raise XinferenceUnavailable(
            "xinference 登录返回 200 但响应里没有 access_token，"
            "多半是版本改了字段名 —— 先看 /openapi.json 里 /token 的响应 schema。",
            retry_after=_FAILURE_COOLDOWN_SECONDS,
        )
    _token = token
    _token_exp = _decode_exp(token)
    _failed_until = 0.0
    _last_error = ""
    try:
        _apply_to_shared_client(token)
    except Exception as exc:  # noqa: BLE001
        # 登录成功但凭据没交到推理面手上：这必须说出口，不能让管理页继续显示「已带上」。
        _last_error = f"shared_client_apply_failed:{type(exc).__name__}"
        raise XinferenceUnavailable(
            f"已拿到 xinference 凭据，但没能交给共享客户端"
            f"（{type(exc).__name__}: {str(exc)[:120]}）。"
            "推理会一直 401，而这不是配置问题，是代码问题 —— 看 src/client.py 的 set_shared_token。"
        ) from exc
    return token


def bearer(force: bool = False) -> Optional[str]:
    """返回可用的 JWT；服务器没开鉴权时返回 None（匿名可用）。"""
    global _failed_until
    if not cluster_authed():
        return None
    now = time.monotonic()
    with _lock:
        if _token and not force:
            exp_soon = _token_exp and (_token_exp - time.time()) < _REFRESH_SKEW_SECONDS
            if not exp_soon:
                return _token
        remaining = _failed_until - now
        if remaining > 0 and not force:
            raise XinferenceUnavailable(
                f"xinference 凭据不可用（{_last_error}），"
                f"冷却期内不再重试，约 {int(remaining)} 秒后再试。",
                retry_after=remaining,
            )
        return _login_locked()


def ensure_fresh() -> None:
    """推理面（`/api/chat`、embedding、rerank）唯一的续期入口。

    为什么必须有它：`bearer()` 只在管理面被调用，而共享句柄里的 `_headers` 是登录那一刻
    推进去的一份快照。服务器默认 30 分钟就过期（`oauth2/advanced/auth_service.py:102`），
    于是「管理员页面没开着、只有人在聊天」过半小时后每条推理都是 401 —— 而 401 会被
    `LazyModelHandle.resolve()` 翻成「模型不可用」，把人指向一个本来就好好的模型。
    这里不返回 token：调用方要的是「凭据是新的」这件事，句柄自己会去读那份 `_headers`。
    代价是一次时间比较，只有真的临近过期才会打一次登录。
    """
    bearer()


def looks_like_auth_rejection(text: str) -> bool:
    """这条上游错误是不是「凭据被拒」。

    判错方向的代价不对称：把 401 说成「模型没加载」，运维会去重载一个本来好好的模型
    （本机实测过这条弯路）；把「模型没加载」说成 401，最多是白点一次重新登录。
    所以这里宁可略宽。
    """
    t = (text or "").lower()
    return any(
        m in t
        for m in (
            "401",
            "could not validate credentials",
            "not authenticated",
            "invalid token",
            "token expired",
            "authorization failure",
        )
    )


def request(
    method: str,
    path: str,
    *,
    json_body: Optional[Any] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: float = 15.0,
) -> Tuple[int, Any]:
    """带鉴权的 xinference 调用；401 时重签一次并重试一次。

    返回 `(status, body)`，body 是解析过的 JSON（解析不了就是原文字符串）。
    **不抛 HTTP 错误**：管理面大量「正常答案」就是 4xx（409 冲突、404 没这个模型），
    状态码要原样交给上层去翻译，而不是在这里压成一个异常。
    """
    url = f"{_base_url()}{path}"
    token = bearer()

    def call(tok: Optional[str]):
        headers = {"Authorization": f"Bearer {tok}"} if tok else {}
        try:
            r = httpx.request(
                method, url, json=json_body, params=params, headers=headers, timeout=timeout
            )
        except httpx.HTTPError as exc:
            raise XinferenceUnavailable(
                f"调用 xinference {path} 失败（{type(exc).__name__}），详情见 ametrine.log。"
            ) from exc
        try:
            return r.status_code, r.json()
        except ValueError:
            return r.status_code, r.text

    status, body = call(token)
    if status == 401:
        status, body = call(bearer(force=True))
    return status, body


def base_url() -> str:
    """服务器地址（不含任何凭据），给界面与日志看。"""
    return _base_url()


def has_credential() -> bool:
    """共享句柄**此刻**带不带 Authorization。

    排查「后端到底能不能推理」时这是第一个要看的事实，而它以前完全不可见
    —— 症状是「服务都起来了，界面就是答不上来」，真相是每次调用都 401。

    句柄现在是惰性的（import 不碰网络），所以后端刚起来、还没人推理时它可能还没建。
    那种情况返回 False 不等于「配错了」，只等于「还没建」——
    界面要分得开这两件事，所以 `state()` 里同时报 `shared_client_built`。
    """
    from src.client import peek_client  # noqa: PLC0415

    shared = peek_client()
    return bool(shared is not None and getattr(shared, "_headers", {}).get("Authorization"))


def state() -> Dict[str, Any]:
    """给就绪面板/管理页看的凭据状态。**只报事实，不报口令**。"""
    from src.client import peek_client  # noqa: PLC0415

    with _lock:
        return {
            "auth_required": bool(_authed) if _authed is not None else None,
            "has_token": bool(_token),
            # 共享句柄建没建 —— 没有它，「client_has_credential=false」会被读成
            # 「凭据没配上」，而那其实只是「还没人触发第一次推理」。
            "shared_client_built": peek_client() is not None,
            "expires_at": _token_exp or None,
            "cooldown_until": (_failed_until if _failed_until > time.monotonic() else 0) or None,
            "last_error": _last_error or None,
            "configured": bool(xinference_admin_user and xinference_admin_password),
        }


def reset() -> None:
    """丢掉缓存的 token（改完 .env 或用户点了「重新登录」时用）。"""
    global _token, _token_exp, _failed_until, _last_error, _authed
    with _lock:
        _token = None
        _token_exp = 0.0
        _failed_until = 0.0
        _last_error = ""
        _authed = None
