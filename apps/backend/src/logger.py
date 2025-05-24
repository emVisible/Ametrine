import inspect
from datetime import datetime
from enum import Enum
from functools import wraps
from logging import DEBUG, INFO, StreamHandler, basicConfig, getLogger
from os import getenv
from os.path import abspath, join

from colorlog import ColoredFormatter
from pydantic import BaseModel

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

file_log = basicConfig(
    filename="ametrine.log",
    level=INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)


class Tags(Enum):
    dev = "DEV"
    llm = "LLM"
    user = "User"
    auth = "Auth"
    vector_db = "Vector Database"
    relation_db = "Relation Database"
    init = "Initialization"


class SystemTags(Enum):
    project = "[Project]"
    auth = "[Auth]"
    vector = "[Vector]"
    model = "[Model]"


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
                    return f"{type(arg).__name__}({arg.dict()})"
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
            except:
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
            duration = (datetime.now() - start).total_seconds()
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
            start = datetime.now()
            try:
                result = await f(*args, **kwargs)
                log_execution(start, args=args, kwargs=kwargs)
                return result
            except Exception as e:
                log_execution(start, success=False, error=e, args=args, kwargs=kwargs)
                raise

        @wraps(f)
        def sync_wrapper(*args, **kwargs):
            start = datetime.now()
            try:
                result = f(*args, **kwargs)
                log_execution(start, args=args, kwargs=kwargs)
                return result
            except Exception as e:
                log_execution(start, success=False, error=e, args=args, kwargs=kwargs)
                raise

        return async_wrapper if is_async else sync_wrapper

    return decorator


def log_config():
    project = SystemTags.project.value
    auth = SystemTags.auth.value
    vector = SystemTags.vector.value
    model = SystemTags.model.value
    env_path = join(abspath("./"), ".env")
    config_logger.critical(f"[{project}]-[ENV_PATH]-{env_path}")
    configs = [
        {"name": "ENV_PATH", "tags": project},
        {"name": "ALGORITHM", "tags": auth},
        {"name": "SECRECT_KEY", "tags": auth},
        {"name": "ACCESS_TOKEN_EXPIRE_MINUTES", "tags": auth},
        {"name": "DB_ADDR", "tags": vector},
        {"name": "DOC_ADDR", "tags": vector},
        {"name": "K", "tags": vector},
        {"name": "P", "tags": vector},
        {"name": "ALLOW_RESET", "tags": vector},
        {"name": "MIN_RELEVANCE_SCORE", "tags": vector},
        {"name": "XINFERENCE_ADDR", "tags": model},
        {"name": "XINFERENCE_LLM_MODEL_ID", "tags": model},
        {"name": "XINFERENCE_EMBEDDING_MODEL_ID", "tags": model},
        {"name": "XINFERENCE_RERANK_MODEL_ID", "tags": model},
        {"name": "CHUNK_SIZE", "tags": model},
        {"name": "CHUNK_OVERLAP", "tags": model},
        {"name": "MAX_MODEL_LEN", "tags": model},
    ]
    for config in configs:
        tag = config["tags"]
        name = config["name"]
        config_logger.critical(f"[{tag}]-[{name}]: {getenv(name)}")
