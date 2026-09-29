from fastapi import APIRouter, Depends, HTTPException, status
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user, permission_map
from .dto import UserCreate, UserUpdate, UserListResponse, UserRead
from .service import UserService, get_user_service

route_base = APIRouter(prefix="/user", tags=[ControllerTag.user])


def _permissions(user) -> list[str]:
    """permission_map 用的是字面量字典，库里出现 1/2/3 之外的 role_id 会抛 KeyError。
    未识别的角色按最小权限处理，而不是让请求 500。"""
    try:
        return permission_map(user.role_id)
    except KeyError:
        return ["user"]


def _is_admin(user) -> bool:
    return "admin" in _permissions(user)


@route_base.post("/create")
async def user_create(
    dto: UserCreate,
    user_service: UserService = Depends(get_user_service),
):
    # 注册接口必须保持匿名可达，但它会写入用户记录；
    # dto 里没有 role_id 通道（服务层固定 role_id=1），所以自助注册拿不到管理员。
    try:
        user = await user_service.create_user(user=dto)
        return UserRead.model_validate(user)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@route_base.get("/all", response_model=UserListResponse)
async def user_all(
    offset: int = 0,
    limit: int = 30,
    user_service: UserService = Depends(get_user_service),
    current_user=Depends(get_current_user),
):
    """
    原来这个端点完全不鉴权，任何人不带凭证就能拿到全站用户名 ——
    再叠加 /api/auth 会区分「用户不存在」和「密码错误」，就是一条完整的账号枚举链。
    现在至少要登录。概览页的「全站用户数」卡片本身就在登录后的界面里，不受影响。
    """
    return await user_service.get_users(offset=offset, limit=limit)


@route_base.get("/{user_id}", response_model=UserRead)
async def user_get_by_id(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
    current_user=Depends(get_current_user),
):
    # 只有本人和管理员能读某个用户的详细资料（含邮箱）
    if user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看该用户")
    user = await user_service.get_user_by_id(user_id=user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户未注册")
    return UserRead.model_validate(user)


@route_base.patch("/{user_id}", response_model=UserRead)
async def user_update(
    user_id: int,
    dto: UserUpdate,
    user_service: UserService = Depends(get_user_service),
    current_user=Depends(get_current_user),
):
    """
    原来任何人都能 PATCH 任意 user_id 的任意字段，包括把自己 role_id 改成 3 ——
    普通用户一次请求就升成管理员。这里补两条：
      1) 只能改自己，除非调用者是管理员；
      2) role_id 属于权限字段，只有管理员能改，且改的是别人。
    """
    if user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改该用户")

    updates = dto.model_dump(exclude_unset=True)
    if "role_id" in updates and updates["role_id"] is not None:
        if not _is_admin(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="只有管理员可以调整角色"
            )
    # 用量配额是资源策略，不是个人偏好：以前普通用户能给自己把日限从 10 万改到 1000 万，
    # 和「配额由管理员定」的语义直接冲突。role_id 之外再挡一层。
    if {"daily_token_limit", "monthly_token_limit"} & set(updates) and not _is_admin(
        current_user
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="用量配额只能由管理员调整"
        )
    return UserRead.model_validate(await user_service.update_user(user_id, dto))


@route_base.delete("/delete")
async def user_delete(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
    current_user=Depends(get_current_user),
):
    if user_id != current_user.id and not _is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除该用户")
    deleted = await user_service.delete_user(user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return {"message": "删除成功"}
