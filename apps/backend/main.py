from os import path
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import (
    get_redoc_html,
    get_swagger_ui_html,
    get_swagger_ui_oauth2_redirect_html,
)
from torch.cuda import empty_cache, ipc_collect, is_available
from src.base.init.controller import route_init
from src.base.controller import route_base
from src.base.database import engine
from src.base.middleware import CORSMiddleware, origins
from src.base.models import Base
from src.llm.controller import route_llm
from src.vector.controller import route_vector_milvus
from src.utils import log_config, config_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    if is_available():
        config_logger.critical("CUDA is available. Initializing...")
    else:
        config_logger.critical("CUDA not available. Proceeding without GPU.")
    yield
    if is_available():
        empty_cache()
        ipc_collect()


load_dotenv("./.env")
log_config()
Base.metadata.create_all(bind=engine)
app = FastAPI(
    title="Ametrine",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/openapi.json",
    swagger_ui_oauth2_redirect_url="/oauth2-redirect",
)
route_prefix = "/api"
app.include_router(route_base, prefix=route_prefix)
app.include_router(route_vector_milvus, prefix=route_prefix)
app.include_router(route_llm, prefix=route_prefix)
app.include_router(route_init, prefix=route_prefix)
app.add_middleware(CORSMiddleware, allow_origins=origins)


@app.get("/")
def root_page():
    return RedirectResponse("/docs")


static_dir = path.dirname(path.abspath(__file__))
app.mount("/static", StaticFiles(directory=f"{static_dir}/static"), name="static")


@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=app.title + " - Swagger UI",
        oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
        swagger_js_url="/static/swagger-ui/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger-ui/swagger-ui.css",
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
