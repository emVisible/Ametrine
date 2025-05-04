from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from main import app
from src.middleware import BaseResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=BaseResponse(
            code=exc.status_code,
            message=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            data=None,
        ).model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=BaseResponse(
            code=422, message="参数校验错误", data=exc.errors()
        ).model_dump(),
    )
