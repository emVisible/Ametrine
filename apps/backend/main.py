from contextlib import asynccontextmanager
from os import path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import (
    get_redoc_html,
    get_swagger_ui_html,
    get_swagger_ui_oauth2_redirect_html,
)
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from src.base.auth.controller import route_auth
from src.base.controller import route_base
from src.base.init.controller import route_init
from src.client import engine
from src.llm.controller import route_llm
from src.middleware.exceptions import (
    custom_http_exception_handler,
    validation_exception_handler,
)
from src.middleware.logger import config_logger, log_config
from src.middleware.response import IResponse
from src.models import Base
from src.relation.controller import route_relation
from src.vector.controller import route_vector_milvus
from starlette.exceptions import HTTPException as StarletteHTTPException
from torch.cuda import empty_cache, ipc_collect, is_available


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
white_list = ["http://127.0.0.1:8000"]
app.include_router(route_base, prefix=route_prefix)
app.include_router(route_auth, prefix=route_prefix)
app.include_router(route_relation, prefix=route_prefix)
app.include_router(route_vector_milvus, prefix=route_prefix)
app.include_router(route_llm, prefix=route_prefix)
app.include_router(route_init, prefix=route_prefix)
app.add_middleware(
    CORSMiddleware, allow_origins=white_list, expose_headers=["X-Session-ID"]
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
