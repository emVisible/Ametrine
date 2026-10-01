from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from src.client import get_relation_db
from src.config import algorithm, secret_key
from src.utils.security import verify
from src.user.service import UserService, get_user_service

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth", scheme_name="data")


class AuthService:
    def __init__(self, client: Session, user_service: UserService):
        self.client = client
        self.user_service = user_service

    def authenticate(self, user, password: str) -> bool:
        if not user:
            return False
        return verify(password, user.password)

    def create_access_token(self, data: dict, expires_delta: timedelta | None = None):
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=30)
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, key=secret_key, algorithm=algorithm)
        return encoded_jwt


async def get_current_user(
    token: str = Depends(oauth2_scheme), user_service=Depends(get_user_service)
):
    try:
        # algorithms 必须是 list：传字符串时 python-jose 会把它按字符拆开比对，
        # 于是 "HS256" 实际允许 "H"/"S"/"2"/"5"/"6" 这些「算法名子串」。
        # 实测 9 种伪造全被拒（alg:none 三种写法、错密钥、HS512、子串算法），
        # 所以这条不是漏洞修复，是把安全性从「第二层恰好失败」换回「第一层就钉死」。
        payload = jwt.decode(
            token=token, key=secret_key, algorithms=[algorithm]
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid user id",
        )
    user = await user_service.get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user not found",
        )
    # 停用要真的能停用。此前 `user.is_active` 在鉴权路径上**一次都没被读过**：
    # 管理台里那个「停用」开关关掉之后，账号既照样能登录，旧令牌也照样能打满有效期。
    # 判 `is False` 而不是 `not`：这列可空且没有 DB 默认值（实测本机 8 个账号全是 True，
    # 但用 SQL 建过的行可能是 NULL），NULL 当作「没被明确停用」，否则这次改动会锁死旧数据。
    if user.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="账号已停用，请联系管理员"
        )
    # 会话吊销：令牌里的 `tv` 必须和库里当前的一致。改角色 / 停用 / 改密 / 换租户都会自增它，
    # 于是「把这个人请出去」不再依赖轮换 SECRET_KEY（那会连带登出所有人）。
    # 旧令牌没有 `tv`（值为 None）一律判失效 —— 不给「没有声明」留兼容通道，
    # 否则这次迁移就成了把无版本令牌永久免检的借口。
    if payload.get("tv") != user.token_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效，请重新登录"
        )
    return user


def permission_map(permission_id: int):
    map = {
        1: ["user"],
        2: ["user", "manager"],
        3: ["user", "manager", "admin"],
    }
    return map[permission_id]


def permissions_of(user) -> list[str]:
    """permission_map 是字面量字典，库里出现 1/2/3 之外的 role_id 会抛 KeyError。
    未识别的角色按最小权限处理，而不是让请求 500。"""
    try:
        return permission_map(getattr(user, "role_id", None) or 0)
    except KeyError:
        return ["user"]


def is_admin(user) -> bool:
    return "admin" in permissions_of(user)


async def get_admin_user(current_user=Depends(get_current_user)):
    """依赖型管理员闸门：/relation 与 /user/permission 的写操作全部只允许管理员调用。"""
    if not is_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可执行此操作"
        )
    return current_user


def get_auth_service(
    client: Session = Depends(get_relation_db),
    user_service: UserService = Depends(get_user_service),
):
    return AuthService(client=client, user_service=user_service)
