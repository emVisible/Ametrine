from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_redis
from src.client import get_relation_db
from src.config import access_token_expire_minutes
from src.middleware.logger import config_logger
from src.middleware.tags import ControllerTag
from src.utils.security import hash as hash_password, verify
from ..quota import usage_snapshot
from ..service import UserService, get_user_service
from .service import AuthService, get_auth_service, get_current_user, permission_map

route_auth = APIRouter(tags=[ControllerTag.auth])

# 「用户不存在」与「密码错」原先回两套 detail，等于给出一份用户名清单；
# 而且前者直接返回、后者要跑一次 bcrypt，时间差本身就又是判据。
# 现在两条分支共用同一句文案、同一量级的开销。
_INVALID_CREDENTIALS = "invalid credentials"

# 固定成本的占位哈希：用户名不存在时也要付一次 bcrypt 校验的开销，
# 否则「快返回」这件事就能被用来枚举用户名。
_NONEXISTENT_USER_HASH = hash_password("ametrine-timing-equalizer")

# 失败计数按 IP+账号 绑定（OWASP 的建议是绑定到账号，避免换 IP 就绕过；
# 只按 IP 又会因为共享出口 NAT 而误伤一整栋楼）。
_FAIL_KEY = "login_fail:{ip}:{account}"
_MAX_FAILURES = 10
_FAIL_WINDOW_SECONDS = 900


def _fail_key(request: Request, account: str) -> str:
    client_ip = request.client.host if request.client else "unknown"
    return _FAIL_KEY.format(ip=client_ip, account=account.strip().lower())


@route_auth.post(
    "/auth",
    response_class=JSONResponse,
)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_service: UserService = Depends(get_user_service),
    auth_service: AuthService = Depends(get_auth_service),
    redis_client=Depends(get_redis),
):
    key = _fail_key(request, form_data.username)
    try:
        failures = int(redis_client.get(key) or 0)
    except (TypeError, ValueError):
        # 计数器坏了就当作没有失败，别让一次 Redis 抖动把登录口焊死
        failures = 0
        config_logger.warning("login failure counter unreadable for %s", key)
    if failures >= _MAX_FAILURES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="失败次数过多，请稍后再试",
        )

    async def _record_failure():
        try:
            count = redis_client.incr(key)
            if count == 1:
                redis_client.expire(key, _FAIL_WINDOW_SECONDS)
        except Exception as exc:  # noqa: BLE001
            config_logger.warning("login failure counter write failed: %s", exc)

    user = await user_service.get_user_by_account(username=form_data.username)
    if not user:
        # 仍然验一次（对占位哈希），两条分支的耗时与响应体都对齐
        verify(form_data.password, _NONEXISTENT_USER_HASH)
        await _record_failure()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID_CREDENTIALS
        )
    if not auth_service.authenticate(user, form_data.password):
        await _record_failure()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_CREDENTIALS,
        )
    redis_client.delete(key)
    # 停用判断放在口令验对**之后**：一个不知道自己密码的人不该通过这条报错得知账号存在，
    # 而验对口令的人本来就持有该账号的凭证，这时「已停用」是有用信息而不是枚举面。
    if user.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用，请联系管理员"
        )
    access_token_expires = timedelta(minutes=access_token_expire_minutes)
    # `tv` 是会话代号（见 models.User.token_version）：不带它就没有「单独吊销某人」的手段。
    access_token = auth_service.create_access_token(
        {"sub": str(user.id), "tv": user.token_version},
        expires_delta=access_token_expires,
    )
    return {"access_token": access_token, "token_type": "bearer"}


@route_auth.get("/current")
async def current_user(
    current_user=Depends(get_current_user),
    quota_db: AsyncSession = Depends(get_relation_db),
):
    # daily_token_used 以前直接回 ORM 上那个从不被写的列，所以永远是 0。
    # 现在回派生值，并带上 monthly 与两个 unlimited 标志 ——
    # 设置页要据此决定画进度条还是写「无限制」，不该自己再判一次 limit<=0。
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "permissions": permission_map(current_user.role_id),
        **(await usage_snapshot(quota_db, current_user)),
    }
