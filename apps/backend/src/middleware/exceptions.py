from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from secrets import token_hex
from src.middleware.logger import config_logger
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
    """422 的正文要能序列化 —— 这条之前不能。

    实测触发方式：`POST /api/inference/models {"model_name":"  "}`，
    自定义 `field_validator` 抛 ValueError 时，pydantic v2 会把**异常对象本身**放进
    `errors()[i]["ctx"]["error"]`，于是 `JSONResponse` 在渲染阶段炸：
    `TypeError: Object of type ValueError is not JSON serializable` → 用户看到裸 500。
    也就是说：**只要某个字段用了自定义校验器，422 就永远以 500 的形式出现**，
    而 500 是本项目专门花了一整节去消灭的那种「什么都不说」的响应。

    三级兜底，任何一级失败都往下退，绝不把「报错」变成「崩」：
      1) `jsonable_encoder(errors(include_url=False))` —— 正常路径；
      2) 去掉 `ctx`（异常对象就住在这里面）；
      3) 只剩 loc/msg 的纯字符串视图。
    """
    from fastapi.encoders import jsonable_encoder

    try:
        data = jsonable_encoder(exc.errors(include_url=False))
    except Exception:  # noqa: BLE001
        try:
            data = jsonable_encoder(
                [{k: v for k, v in e.items() if k != "ctx"} for e in exc.errors()]
            )
        except Exception:  # noqa: BLE001
            data = [
                {
                    "loc": [str(x) for x in e.get("loc", ())],
                    "msg": str(e.get("msg", "")),
                    "type": str(e.get("type", "")),
                }
                for e in exc.errors()
            ]
    return JSONResponse(
        status_code=422,
        content=BaseResponse(code=422, message="参数校验错误", data=data).model_dump(),
    )


def _unavailable_response(exc, message: str) -> JSONResponse:
    """503 + Retry-After 的共同形状。

    为什么单独抽出来：这类故障都发生在**依赖解析阶段**，路由里那些精心分好的状态码
    一个都到不了；而「服务端知道自己多久之后值得再试」这件事，客户端值得知道。
    """
    headers = {}
    retry_after = getattr(exc, "retry_after", 0.0)
    if retry_after:
        headers["Retry-After"] = str(int(retry_after))
    return JSONResponse(
        status_code=503,
        content=BaseResponse(code=503, message=message, data=None).model_dump(),
        headers=headers,
    )


async def tokenizer_unavailable_handler(request: Request, exc):
    """分词器不可用 → 503，而不是什么信息都没有的 500。

    这条路径原来是在**依赖解析阶段**炸的，路由里那些精心分好的状态码一个都到不了；
    带上 Retry-After 是因为失败冷却是服务端真实的状态，客户端值得知道还要等多久。
    """
    return _unavailable_response(exc, str(exc))


async def xinference_unavailable_handler(request: Request, exc):
    """连不上 xinference / 凭据不可用 → 503。

    和分词器同一条道理：这是部署级故障，不是调用方的错，改请求参数没用。
    不回 500 是因为 500 会让人去翻后端代码，而真正的原因通常是「.env 没配口令」。
    """
    return _unavailable_response(exc, str(exc))


async def model_unavailable_handler(request: Request, exc):
    """绑定的模型没加载 → 503，而不是 500 + 追踪码。

    这条之前是裸 `RuntimeError`，所以它一路走到兜底处理器，用户看到的是
    「服务内部错误（追踪码 …）」—— 而系统其实明确知道缺哪个模型、该去哪儿加载。
    """
    return _unavailable_response(exc, str(exc))


async def xinference_rejected_handler(request: Request, exc):
    """xinference 明确拒绝的动作：状态码原样翻译，不要退化成 500。

    没有这个处理器时，`XinferenceRejected` 会一路走到兜底 → 「服务内部错误 + 追踪码」，
    而它其实是很有信息量的一句「这个 uid 没在跑」「维度对不上」。
    """
    code = getattr(exc, "status_code", 502)
    return JSONResponse(
        status_code=code,
        content=BaseResponse(code=code, message=str(exc), data=None).model_dump(),
    )


async def unhandled_exception_handler(request: Request, exc: Exception):
    """兜底：任何没被路由接住的异常也走统一的响应信封。

    之前这条路径回的是 Starlette 的纯文本 `Internal Server Error` —— 信封形状在这里断了，
    前端 `response.data.message` 拿到 undefined，用户看到的是「转圈之后什么都不发生」。
    回应里只给追踪码，不给堆栈（堆栈里可能有路径、连接串、依赖版本）；
    服务端日志里用同一个追踪码打全栈，运维一条 grep 就能对上。
    """
    trace_id = token_hex(8)
    config_logger.exception(
        "unhandled [%s] %s %s: %s",
        trace_id,
        request.method,
        request.url.path,
        exc,
    )
    return JSONResponse(
        status_code=500,
        content=BaseResponse(
            code=500,
            message=f"服务内部错误（追踪码 {trace_id}，可在 ametrine.log 里检索）",
            data=None,
        ).model_dump(),
    )
