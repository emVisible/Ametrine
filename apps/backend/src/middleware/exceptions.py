from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from src.middleware.response import BaseResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


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


class JWTException(HTTPException):
    def __init__(self):
        super().__init__(status_code=401, detail="JWT token error")


class ForbiddenException(HTTPException):
    def __init__(self):
        super().__init__(status_code=403, detail="You don't have enough permissions")
