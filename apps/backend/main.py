from os import path, getenv, environ
from contextlib import asynccontextmanager

import asyncio
import anyio
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import (
    get_redoc_html,
    get_swagger_ui_html,
    get_swagger_ui_oauth2_redirect_html,
)
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from torch.cuda import empty_cache, ipc_collect, is_available
from pymilvus import MilvusClient
from redis import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.chat.controller import route_chat
from src.client import (
    async_session,
    engine,
    get_milvus_service,
    get_redis,
    get_relation_db,
    TokenizerUnavailable,
)
from src.config import ENV_FILE, cors_origins
from src.version import APP_VERSION
from src.conversation.controller import route_conversation
from src.inference import auth as inference_auth
from src.inference import bindings as inference_bindings
from src.inference.controller import route_inference
from src.inference.errors import ModelUnavailable, XinferenceRejected, XinferenceUnavailable
from src.llm.controller import route_llm
from src.middleware.exceptions import (
    custom_http_exception_handler,
    model_unavailable_handler,
    tokenizer_unavailable_handler,
    unhandled_exception_handler,
    validation_exception_handler,
    xinference_rejected_handler,
    xinference_unavailable_handler,
)
from src.middleware.logger import config_logger, log_config
from src.middleware.response import IResponse
from src.models import Base
from src.relation.controller import route_relation
from src.system.controller import route_system
from src.user.auth.controller import route_auth
from src.user.controller import route_base
from src.user.permissions.controller import route_user_permission
from src.vector.controller import route_vector_milvus


async def bootstrap_inference():
    """启动时把「角色 → 模型」读进内存，并顺手试一次 xinference 登录。

    两件事都必须在这里做而不是等第一个请求：
      * 绑定不预读，同步 getter 就得在每条请求里查库（而它是同步函数，查不了）；
      * 登录失败要**在启动日志里就看得见**。这台机器真实的教训是：服务全部健康、
        界面就是答不上来，真相是后端每次调用 xinference 都 401 —— 而当时没有任何地方
        说得出这件事。
    """
    try:
        async with async_session() as session:
            snap = await inference_bindings.bootstrap(session)
        config_logger.critical("inference bindings loaded: %s", snap or "(空，回落 .env)")
    except Exception as exc:  # noqa: BLE001 读不到绑定不该阻止应用起来
        config_logger.error("读取推理绑定失败，回落 .env 的模型 id：%s", exc)

    try:
        await anyio.to_thread.run_sync(inference_auth.bearer)
        config_logger.critical("xinference 凭据就绪（%s）", inference_auth.base_url())
    except Exception as exc:  # noqa: BLE001
        config_logger.warning("拿不到 xinference 凭据，推理相关接口会回 503：%s", exc)


async def keep_bindings_fresh():
    """绑定快照的**唯一**定期重读者。

    快照是进程内的，而 `bindings.stale()` 以前只有两个管理端 GET 在问；多 worker 部署
    （`bindings.py` 里 `STALE_AFTER_SECONDS` 就是为它写的）下，A 进程改了绑定，
    B 进程永远不去读 ⇒ 「界面显示已换、一部分请求一直走旧模型」。同步 getter 不能查库
    （每条请求都要走它），所以重读放在这里：读侧仍然零 IO，而那条 TTL 第一次真的生效。
    """
    while True:
        await anyio.sleep(inference_bindings.STALE_AFTER_SECONDS)
        try:
            async with async_session() as session:
                changed = await inference_bindings.refresh_if_changed(session)
            if changed:
                config_logger.critical("推理绑定快照已更新（可能是别的 worker 改的）：%s", changed)
        except anyio.get_cancelled_exc_class():
            raise
        except Exception as exc:  # noqa: BLE001 定期任务不许把应用带崩
            config_logger.warning("定期重读推理绑定失败：%s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if is_available():
        config_logger.critical("CUDA is available. Initializing...")
    else:
        config_logger.critical("CUDA not available. Proceeding without GPU.")
    await create_all()
    await bootstrap_inference()
    refresher = asyncio.create_task(keep_bindings_fresh())
    try:
        yield
    finally:
        refresher.cancel()
        # 关连接池不该看 CUDA 的脸色：engine 是无条件建出来的，原来它写在
        # `if is_available()` 里面 —— 没有 GPU 的部署每次关停都漏一个连接池。
        await engine.dispose()
        if is_available():
            empty_cache()
            ipc_collect()


load_dotenv(ENV_FILE)
for key in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"):
    value = getenv(key)
    if value:
        environ[key] = value

log_config()
app = FastAPI(
    title="Ametrine",
    version=APP_VERSION,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    swagger_ui_oauth2_redirect_url="/oauth2-redirect",
    default_response_class=IResponse,
)
app.add_exception_handler(StarletteHTTPException, custom_http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
# 依赖解析阶段抛的异常不会经过路由里的 try/except，所以「分词器不可用」这类
# 部署级故障必须由应用层统一翻译成 503，否则它们永远是裸 500。
app.add_exception_handler(TokenizerUnavailable, tokenizer_unavailable_handler)
# xinference 连不上/凭据不可用同样是部署级故障（且常在依赖阶段抛出）→ 503 + Retry-After
app.add_exception_handler(XinferenceUnavailable, xinference_unavailable_handler)
# 绑定的模型没加载 → 503 并说出该去哪儿加载。以前这条是裸 500 + 追踪码，
# 而系统其实明确知道缺哪个模型 —— 那是「把已知的事说成未知」。
app.add_exception_handler(ModelUnavailable, model_unavailable_handler)
# 服务器明确拒绝的动作（400/404/409）要原样说出去，不能退化成「服务内部错误 + 追踪码」
app.add_exception_handler(XinferenceRejected, xinference_rejected_handler)
# 兜底必须是**最后一个**注册的 Exception 处理器：它保证任何漏网异常也回到统一信封，
# 而不是 Starlette 的纯文本 `Internal Server Error`（前端解析不到 message 就只剩转圈）。
app.add_exception_handler(Exception, unhandled_exception_handler)
route_prefix = "/api"
# 来源列表由 CORS_ORIGINS 给（逗号分隔），默认只放本机 vite 的地址。
# 这里原来还挂着 "*"，而 allow_credentials=True —— 通配来源 + 允许带凭据
# 等于「任何网站都能拿用户浏览器里已有的凭证打这台机器」，虽然实际浏览器会拒绝
# 通配与凭证并存，但配置本身是错的，而且 "*" 让「加新前端」变成一件不用思考的事。
white_list = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
app.include_router(route_base, prefix=route_prefix)
app.include_router(route_auth, prefix=route_prefix)
app.include_router(route_relation, prefix=route_prefix)
app.include_router(route_vector_milvus, prefix=route_prefix)
app.include_router(route_chat, prefix=route_prefix)
app.include_router(route_llm, prefix=route_prefix)
app.include_router(route_conversation, prefix=route_prefix)
app.include_router(route_user_permission, prefix="/api")
app.include_router(route_system, prefix=route_prefix)
# 推理管理面：整面只允许管理员（闸门挂在 router 的 dependencies 上，新加路由不会漏判）
app.include_router(route_inference, prefix=route_prefix)


app.add_middleware(
    CORSMiddleware,
    allow_origins=white_list,
    expose_headers=["X-Session-ID"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def create_all():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get("/")
def root_page():
    return RedirectResponse("/docs")


static_dir = path.dirname(path.abspath(__file__))
app.mount("/static", StaticFiles(directory=f"{static_dir}/static"), name="static")


@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=app.title,
        oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
        swagger_js_url="/static/swagger/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger/swagger-ui.css",
    )


@app.get(app.swagger_ui_oauth2_redirect_url, include_in_schema=False)
async def swagger_ui_redirect():
    return get_swagger_ui_oauth2_redirect_html()


@app.get("/redoc", include_in_schema=False)
async def redoc_html():
    return get_redoc_html(
        openapi_url=app.openapi_url,
        title=app.title + " - ReDoc",
        redoc_js_url="/static/redoc/redoc.standalone.js",
    )


@app.get("/health")
async def health(
    db: AsyncSession = Depends(get_relation_db),
    redis: Redis = Depends(get_redis),
    milvus: MilvusClient = Depends(get_milvus_service),
):
    """外部探针用的存活检查：只回答 ok / 哪个组件不行。

    原来这里把 str(e) 原样返回，而它是匿名可达的 —— psycopg / redis 的连接错误里
    通常带主机名与端口。带上下文的诊断信息挪到了登录后的 /api/system/overview。
    """
    status = {
        "status": "ok",
        # 读 src/version.py：这里以前自己写死一个字符串，于是 `/health`、OpenAPI 与
        # pyproject 三个地方可以各说一套（v0.2.0 那次就是这样）。
        "version": APP_VERSION,
        "services": {},
    }

    def fail(key: str, err: Exception):
        status["services"][key] = f"error:{type(err).__name__}"
        status["status"] = "degraded"

    try:
        await db.execute(text("SELECT 1"))
        status["services"]["postgres"] = "ok"
    except Exception as e:
        fail("postgres", e)
    try:
        redis.ping()
        status["services"]["redis"] = "ok"
    except Exception as e:
        fail("redis", e)
    try:
        milvus.list_databases()
        status["services"]["milvus"] = "ok"
    except Exception as e:
        fail("milvus", e)

    return status
