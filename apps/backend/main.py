from os import path, getenv, environ
from contextlib import asynccontextmanager

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
from src.client import engine, get_milvus_service, get_redis, get_relation_db
from src.conversation.controller import route_conversation
from src.llm.controller import route_llm
from src.middleware.exceptions import (
    custom_http_exception_handler,
    validation_exception_handler,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    if is_available():
        config_logger.critical("CUDA is available. Initializing...")
    else:
        config_logger.critical("CUDA not available. Proceeding without GPU.")
    await create_all()
    yield
    if is_available():
        empty_cache()
        ipc_collect()
        await engine.dispose()


load_dotenv("./.env")
for key in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"):
    value = getenv(key)
    if value:
        environ[key] = value

log_config()
app = FastAPI(
    title="Ametrine",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    swagger_ui_oauth2_redirect_url="/oauth2-redirect",
    default_response_class=IResponse,
)
app.add_exception_handler(StarletteHTTPException, custom_http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
route_prefix = "/api"
white_list = ["http://127.0.0.1:8000", "http://localhost:8000", "*"]
app.include_router(route_base, prefix=route_prefix)
app.include_router(route_auth, prefix=route_prefix)
app.include_router(route_relation, prefix=route_prefix)
app.include_router(route_vector_milvus, prefix=route_prefix)
app.include_router(route_chat, prefix=route_prefix)
app.include_router(route_llm, prefix=route_prefix)
app.include_router(route_conversation, prefix=route_prefix)
app.include_router(route_user_permission, prefix="/api")
app.include_router(route_system, prefix=route_prefix)


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
        "version": "0.1.0",
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
