import inspect
from datetime import datetime, timezone
from functools import wraps
from logging import DEBUG, FileHandler, Formatter, INFO, StreamHandler, basicConfig, getLogger

from colorlog import ColoredFormatter
from pydantic import BaseModel

from .tags import LoggerTag
from ..config import LOG_FILE, ENV_FILE, settings

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
# propagate=False 本身是对的（否则同一条会经 root 再打一遍），但配上下面的
# basicConfig(filename=...) 之后，ametrine.log 只挂在 root 上，
# 这个 logger 的日志就永远进不了文件 —— 出问题时没有任何事后可言。
# 所以显式再挂一个文件 handler，控制台与文件两边都留痕。
config_logger.propagate = False

basicConfig(
    filename=LOG_FILE,
    level=INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)

_file_handler = FileHandler(LOG_FILE, encoding="utf-8")
_file_handler.setLevel(INFO)
_file_handler.setFormatter(
    Formatter("%(asctime)s - %(levelname)-8s - %(message)s")
)
config_logger.addHandler(_file_handler)


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
        "XINFERENCE_LLM_MODEL_ID",
        "XINFERENCE_EMBEDDING_MODEL_ID",
        "EMBEDDING_DIMENSION",
        "XINFERENCE_RERANK_MODEL_ID",
        "TOKENIZER_ADDR",
    ],
    LoggerTag.vector: [
        "MILVUS_HOST",
        "MILVUS_PORT",
        "MILVUS_METRIC_TYPE",
        "MILVUS_INDEX_TYPE",
        "MILVUS_INDEX_NLIST",
        "REDIS_HOST",
        "REDIS_PORT",
        "REDIS_DB",
        "REDIS_PASSWORD",
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
# DTO 字段名里出现这些词就打成 ****：pydantic 模型不该决定日志的泄密面。
_SENSITIVE_ARG_KEYS = {
    "password",
    "passwd",
    "secret",
    "secret_key",
    "token",
    "access_token",
    "api_key",
    "authorization",
    "postgre_addr",
}
# 单个参数的上限。正文长是合理的，无限长不是 —— 一条 40 万字的 prompt 会把日志文件吃掉。
_LOG_ARG_MAX = 1500


def log(text: str, log_args: bool = True):
    def decorator(f):
        is_async = inspect.iscoroutinefunction(f)

        def format_arg_value(arg) -> str:
            """参数只打「请求 DTO」，其余一律只留类型名。

            原来这里对任何带 `__dict__` 的参数都做 `vars()` 展开，而路由的参数里
            除了 DTO 还有 **ORM 行、Redis 客户端、AsyncSession、模型句柄**。
            实测后果写在 `ametrine.log` 里：**4 条真实的 bcrypt 口令哈希**（`$2b$12$…`）
            和 63 处 Redis `ConnectionPool` 内部结构 —— 只要任何一次请求失败，
            `@log` 就会把当前用户的整行 ORM 一起打出来。口令哈希进了日志文件，
            和明文写进去只差一次离线破解。
            """
            if arg is None:
                return "None"
            if isinstance(arg, BaseModel):
                data = {
                    k: "****" if str(k).lower() in _SENSITIVE_ARG_KEYS else v
                    for k, v in arg.model_dump().items()
                }
                return f"{type(arg).__name__}({data})"[:_LOG_ARG_MAX]
            if isinstance(arg, (str, int, float, bool)):
                return repr(arg)[:_LOG_ARG_MAX]
            return f"<{type(arg).__name__}>"

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


def _mask_url_credentials(value: str) -> str:
    """把连接串里的口令换成 ****，保留用户与主机端口便于诊断。

    原来的写法是 `value.replace("://", "://****@")`，实测启动日志里打出来的是
    `postgresql+asyncpg://****@postgres:preview@localhost:5432/ametrine` ——
    星号只是插在了 scheme 后面，真口令 `preview` 一个字都没遮，
    而这条日志会落进 ametrine.log（OWASP Logging Cheat Sheet 明确禁止记口令）。
    """
    if "://" not in value:
        return value
    scheme, _, remainder = value.partition("://")
    credentials, has_at, host = remainder.rpartition("@")
    if not has_at:
        return value
    user, _, _password = credentials.partition(":")
    return f"{scheme}://{user}:****@{host}"


# ─── 启动配置打印 ───
def log_config():
    """从 Settings 实例自动读取所有配置并分组打印"""
    # 绝对路径：这一行原来打的是 `abspath("./")/.env`，于是「日志里说它读了哪个 .env」
    # 会随启动目录变化，排查时反而误导（本机曾因此在前端目录里看到一份 .env 字样）。
    env_path = ENV_FILE
    config_logger.critical(f"[{LoggerTag.project.value}]-[ENV_PATH]: {env_path}")

    # Settings 字段名 → alias 的映射
    field_aliases = {
        field_name: field.alias for field_name, field in settings.model_fields.items()
    }

    for tag, aliases in _TAG_CONFIG_MAP.items():
        for alias in aliases:
            # 从 settings 取值
            value = getattr(settings, alias.lower(), None)
            # 敏感信息脱敏
            if alias in ("SECRET_KEY", "REDIS_PASSWORD"):
                display_value = f"{str(value)[:4]}****" if value else "None"
            elif alias == "POSTGRE_ADDR":
                # 数据库连接串隐藏密码
                display_value = _mask_url_credentials(str(value)) if value else "None"
            else:
                display_value = value
            config_logger.critical(f"[{tag.value}]-[{alias}]: {display_value}")
