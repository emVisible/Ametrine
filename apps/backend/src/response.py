from pydantic import BaseModel
from typing import Any, Generic, Optional, TypeVar
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

T = TypeVar("T")


class BaseResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T]


class IResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        if not isinstance(content, BaseResponse):
            content = BaseResponse(data=content)
        return super().render(content.model_dump())


async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=BaseResponse(
            code=exc.status_code,
            message=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            data=None,
        ).model_dump(),
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=BaseResponse(
            code=422, message="参数校验错误", data=exc.errors()
        ).model_dump(),
    )



async def custom_jwt_exception_handler():
    return JSONResponse(
        status_code=401,
        content=BaseResponse(
            code=401, message="JWT token error", data=None
        ).model_dump(),
    )