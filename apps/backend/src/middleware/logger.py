import inspect
from datetime import datetime, timezone
from functools import wraps
from logging import DEBUG, INFO, StreamHandler, basicConfig, getLogger
from os.path import abspath, join

from colorlog import ColoredFormatter
from pydantic import BaseModel

from .tags import LoggerTag
from ..config import settings

# ─── 日志格式 ───
formatter = ColoredFormatter(
    "%(log_color)s%(levelname)-8s%(reset)s %(blue)s%(message)s",
    log_colors={
        "DEBUG": "cyan",
        "INFO": "green",
        "WARNING": "yellow",
        "ERROR": "red",
        "CRITICAL": "bold_red",
    },
)

config_logger = getLogger("fastapi")
config_logger.handlers.clear()
console_handler = StreamHandler()
console_handler.setFormatter(formatter)
config_logger.setLevel(DEBUG)
config_logger.addHandler(console_handler)
config_logger.propagate = False

basicConfig(
    filename="ametrine.log",
    level=INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)


# ─── 配置项 → 标签映射 ───
# 每个 LoggerTag 对应的配置 alias 列表
_TAG_CONFIG_MAP = {
    LoggerTag.project: [
        "ENV_PATH",
    ],
    LoggerTag.auth: [
        "ALGORITHM",
        "SECRET_KEY",
        "ACCESS_TOKEN_EXPIRE_MINUTES",
    ],
    LoggerTag.model: [
        "XINFERENCE_MAIN_ADDR",
        "XINFERENCE_VICE_ADDR",
        "XINFERENCE_LLM_MODEL_ID",
        "XINFERENCE_EMBEDDING_MODEL_ID",
        "EMBEDDING_DIMENSION",
        "XINFERENCE_RERANK_MODEL_ID",
        "XINFERENCE_STT_MODEL_ID",
        "XINFERENCE_TTS_MODEL_ID",
        "TOKENIZER_ADDR",
    ],
    LoggerTag.audio: [
        "XINFERENCE_STT_MODEL_ID",
        "XINFERENCE_TTS_MODEL_ID",
    ],
    LoggerTag.vector: [
        "MILVUS_HOST",
        "MILVUS_PORT",
        "MILVUS_METRIC_TYPE",
        "MILVUS_INDEX_TYPE",
        "MILVUS_INDEX_NLIST",
        "DB_ADDR",
        "DOC_ADDR",
        "K",
        "P",
        "MIN_RELEVANCE_SCORE",
        "CHUNK_SIZE",
        "CHUNK_OVERLAP",
        "MAX_MODEL_LEN",
    ],
    LoggerTag.relation: [
        "POSTGRE_ADDR",
        "POSTGRE_LOG",
    ],
    LoggerTag.preprocess: [
        "SEMANTIC_SPLITTER",
        "OCR_AGENT",
    ],
    LoggerTag.agent: [
        "AGENT_SHELL_ENABLED",
    ],
    LoggerTag.performance: [
        "SEMAPHORE",
    ],
    LoggerTag.network: [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ],
}


# ─── 请求日志装饰器 ───
def log(text: str, log_args: bool = True):
    def decorator(f):
        is_async = inspect.iscoroutinefunction(f)

        def format_arg_value(arg) -> str:
            if arg is None:
                return "None"
            if hasattr(arg, "__dict__") and not isinstance(
                arg, (str, int, float, bool)
            ):
                if isinstance(arg, BaseModel):
                    return f"{type(arg).__name__}({arg.model_dump()})"
                else:
                    attrs = {
                        k: v
                        for k, v in vars(arg).items()
                        if not k.startswith("_") and not callable(v)
                    }
                    return f"{type(arg).__name__}({attrs})"
            return repr(arg)

        def format_args(args: tuple, kwargs: dict) -> str:
            try:
                arg_names = inspect.getfullargspec(f).args
            except Exception:
                arg_names = []

            args_info = []
            for i, arg in enumerate(args):
                name = arg_names[i] if i < len(arg_names) else f"arg{i}"
                args_info.append(f"    {name}: {format_arg_value(arg)}")
            for k, v in kwargs.items():
                args_info.append(f"    {k}: {format_arg_value(v)}")

            return "\n" + "\n".join(args_info) if args_info else "No params"

        def log_execution(
            start: datetime,
            success: bool = True,
            error: Exception = None,
            args: tuple = (),
            kwargs: dict = {},
        ):
            duration = (datetime.now(timezone.utc) - start).total_seconds()
            base_msg = f"{text}\n ⏳Time: {duration:.3f}s"

            if log_args:
                args_info = f"\n Params: {format_args(args, kwargs)}"
                base_msg += args_info

            if success:
                config_logger.debug(f"{base_msg}")
            else:
                config_logger.error(
                    f"💥 {base_msg}\n ❗Error: {type(error).__name__}: {str(error)}",
                    exc_info=bool(error),
                )

        @wraps(f)
        async def async_wrapper(*args, **kwargs):
            start = datetime.now(timezone.utc)
            try:
                result = await f(*args, **kwargs)
                log_execution(start, args=args, kwargs=kwargs)
                return result
            except Exception as e:
                log_execution(start, success=False, error=e, args=args, kwargs=kwargs)
                raise

        @wraps(f)
        def sync_wrapper(*args, **kwargs):
            start = datetime.now(timezone.utc)
            try:
                result = f(*args, **kwargs)
                log_execution(start, args=args, kwargs=kwargs)
                return result
            except Exception as e:
                log_execution(start, success=False, error=e, args=args, kwargs=kwargs)
                raise

        return async_wrapper if is_async else sync_wrapper

    return decorator


# ─── 启动配置打印 ───
def log_config():
    """从 Settings 实例自动读取所有配置并分组打印"""
    env_path = join(abspath("./"), ".env")
    config_logger.critical(
        f"[{LoggerTag.project.value}]-[ENV_PATH]: {env_path}"
    )

    # Settings 字段名 → alias 的映射
    field_aliases = {
        field_name: field.alias
        for field_name, field in settings.model_fields.items()
    }

    for tag, aliases in _TAG_CONFIG_MAP.items():
        for alias in aliases:
            # 从 settings 取值
            value = getattr(settings, alias.lower(), None)
            # 敏感信息脱敏
            if alias in ("SECRET_KEY",):
                display_value = f"{str(value)[:4]}****" if value else "None"
            elif alias in ("POSTGRE_ADDR", "DB_ADDR"):
                # 数据库连接串隐藏密码
                display_value = str(value).replace("://", "://****@") if value else "None"
            else:
                display_value = value
            config_logger.critical(
                f"[{tag.value}]-[{alias}]: {display_value}"
            )