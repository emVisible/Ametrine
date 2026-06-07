from fastapi import APIRouter, Depends, HTTPException, status
from src.middleware.tags import ControllerTag
from .dto import UserCreate, UserUpdate, UserListResponse, UserRead
from .service import UserService, get_user_service

route_base = APIRouter(prefix="/user", tags=[ControllerTag.user])


@route_base.post("/create")
async def user_create(
    dto: UserCreate,
    user_service: UserService = Depends(get_user_service),
):
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
):
    return await user_service.get_users(offset=offset, limit=limit)


@route_base.get("/{user_id}", response_model=UserRead)
async def user_get_by_id(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
):
    user = await user_service.get_user_by_id(user_id=user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户未注册")
    return UserRead.model_validate(user)


@route_base.patch("/{user_id}", response_model=UserRead)
async def user_update(
    user_id: int,
    dto: UserUpdate,
    user_service: UserService = Depends(get_user_service),
):
    user = await user_service.update_user(user_id, dto)
    return UserRead.model_validate(user)


@route_base.delete("/delete")
async def user_delete(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
):
    deleted = await user_service.delete_user(user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return {"message": "删除成功"}
