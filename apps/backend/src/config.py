from functools import lru_cache
from os import W_OK, X_OK, access
from os.path import abspath, dirname, join, normpath
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings

# 后端自己的目录（apps/backend）。.env 与日志都必须按**这个**路径解析，不能跟着 cwd 走：
# 以别的目录启动时，相对路径会让它静悄悄读到空 .env（症状是「字段缺失」而不是「没读到文件」），
# 并把含口令的启动日志写进别人的目录 —— 本机真的在 apps/frontend/src/components/ 里
# 长出过一份 ametrine.log，里面带的是当时的真实数据库口令。
BACKEND_ROOT = dirname(dirname(abspath(__file__)))
# 仓库根：DOC_ADDR 的相对值按它解析，而不是按 cwd（理由见 _absolutize_doc_addr）。
REPO_ROOT = dirname(dirname(BACKEND_ROOT))
ENV_FILE = join(BACKEND_ROOT, ".env")
LOG_FILE = join(BACKEND_ROOT, "ametrine.log")


class Settings(BaseSettings):
    http_proxy: str = Field(default="", alias="HTTP_PROXY")
    https_proxy: str = Field(default="", alias="HTTPS_PROXY")
    no_proxy: str = Field(default="localhost,127.0.0.1,.local", alias="NO_PROXY")

    algorithm: str = Field(..., alias="ALGORITHM")
    secret_key: str = Field(..., alias="SECRET_KEY")
    access_token_expire_minutes: int = Field(..., alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    # 浏览器里前端的来源。原先 main.py 写死成 ["http://127.0.0.1:8000", ..., "*"]，
    # "*" 让 allow_credentials=True 形同虚设：任何页面都能带着用户的 token 打这台机器。
    # 逗号分隔，默认只放本机 vite 的地址。
    cors_origins: str = Field(
        default="http://127.0.0.1:8000,http://localhost:8000", alias="CORS_ORIGINS"
    )

    xinference_addr: str = Field(..., alias="XINFERENCE_MAIN_ADDR")
    # xinference 2.x 匿名可用；3.x 服务端强制鉴权（见 docs/refactor 那篇依赖分析）。
    # 留空 = 按匿名处理，所以现在这台 2.10 服务器不受影响。
    xinference_api_key: str = Field(default="", alias="XINFERENCE_API_KEY")
    # 管理员账号只用来做两件事：换 JWT 以调用**管理面**（launch / terminate / autostart），
    # 以及给推理面提供同一把 Bearer。实测：用户级 JWT 打 /v1/models 与推理端点都 200，
    # 而 API key 的 scope 被服务器限死在 models:read / models:list（不能 launch）。
    # 所以推理不再依赖 XINFERENCE_API_KEY —— 它保留是为了外部客户端仍然能用签发的 key 接入。
    xinference_admin_user: str = Field(default="", alias="XINFERENCE_ADMIN_USER")
    xinference_admin_password: str = Field(default="", alias="XINFERENCE_ADMIN_PASSWORD")
    xinference_llm_model_id: str = Field(..., alias="XINFERENCE_LLM_MODEL_ID")
    xinference_embedding_model_id: str = Field(
        ..., alias="XINFERENCE_EMBEDDING_MODEL_ID"
    )
    embedding_dimension: int = Field(default=1024, alias="EMBEDDING_DIMENSION")
    xinference_rerank_model_id: str = Field(..., alias="XINFERENCE_RERANK_MODEL_ID")
    tokenizer_addr: str = Field(..., alias="TOKENIZER_ADDR")

    milvus_host: str = Field(default="127.0.0.1", alias="MILVUS_HOST")
    milvus_port: str = Field(default="19530", alias="MILVUS_PORT")
    milvus_metric_type: str = Field(default="L2", alias="MILVUS_METRIC_TYPE")
    milvus_index_type: str = Field(default="IVF_FLAT", alias="MILVUS_INDEX_TYPE")
    milvus_index_nlist: int = Field(default=256, alias="MILVUS_INDEX_NLIST")
    # Redis 原来在 src/client.py 里写死 127.0.0.1:6379 db0 —— 那意味着「换一台机器就要改代码」，
    # 而 compose 起的 Redis 恰恰是最常被改端口/改密码/换主机的一个。
    redis_host: str = Field(default="127.0.0.1", alias="REDIS_HOST")
    redis_port: int = Field(default=6379, alias="REDIS_PORT")
    redis_db: int = Field(default=0, alias="REDIS_DB")
    redis_password: str = Field(default="", alias="REDIS_PASSWORD")
    doc_addr: str = Field(..., alias="DOC_ADDR")
    # 上传上限。原先没有任何上限：一次误传（或者一个故意的请求）就能把这台机器的盘写满，
    # 而且 `await file.read()` 是整份进内存，上限同时也是内存上限。
    # 参照 Dify 的默认（UPLOAD_FILE_SIZE_LIMIT=15MB）。
    max_upload_bytes: int = Field(
        default=15 * 1024 * 1024, alias="MAX_UPLOAD_BYTES"
    )
    k: int = Field(..., alias="K")
    p: int = Field(..., alias="P")
    min_relevance_score: float = Field(..., alias="MIN_RELEVANCE_SCORE")
    # 入侧预算。K/P/阈值都只管得出侧，而 top_k 原来是请求方想给多大给多大：
    # 一次 top_k=100000 就足以把共享的检索与重排算力打满（参照 Dify 的 TOP_K_MAX_VALUE）。
    # 越界一律 422 明说，而不是悄悄夹住 —— 静默改小调用方的参数是另一种撒谎。
    max_top_k: int = Field(default=20, alias="MAX_TOP_K")
    max_prompt_chars: int = Field(default=8000, alias="MAX_PROMPT_CHARS")
    max_history_messages: int = Field(default=50, alias="MAX_HISTORY_MESSAGES")
    chunk_size: int = Field(..., alias="CHUNK_SIZE")
    chunk_overlap: int = Field(..., alias="CHUNK_OVERLAP")
    max_model_len: int = Field(..., alias="MAX_MODEL_LEN")
    postgre_addr: str = Field(..., alias="POSTGRE_ADDR")
    postgre_log: bool = Field(..., alias="POSTGRE_LOG")

    semantic_splitter: bool = Field(..., alias="SEMANTIC_SPLITTER")
    ocr_agent: str = Field(..., alias="OCR_AGENT")

    semaphore: int = Field(..., alias="SEMAPHORE")
    # 单账号同时在生成的回答路数。全局 `SEMAPHORE` 管的是整机，没有它的话
    # 一个人开几十个标签页就能把整台机器占满，而别人看到的是「一直在转」。
    # <=0 表示不限制。
    max_concurrent_streams_per_user: int = Field(
        default=2, alias="MAX_CONCURRENT_STREAMS_PER_USER"
    )
    # 块**间**空闲上限，不是回答总时长：长答案是合法需求，卡住的上游才是故障。
    # 超时后这一路被关掉并让出名额，而不是永远占着。
    stream_idle_timeout_seconds: int = Field(default=120, alias="STREAM_IDLE_TIMEOUT_SECONDS")

    @field_validator("doc_addr", mode="after")
    @classmethod
    def _absolutize_doc_addr(cls, value: str) -> str:
        """把 DOC_ADDR 钉成一个绝对路径。

        .env.example 给的示例值是相对**仓库根**写的（apps/database/docs），但 uvicorn 的
        工作目录是 apps/backend（见根 dev.sh）。相对路径按 cwd 解析，于是照着示例填的人
        会把原文写进 apps/backend/apps/database/docs —— 上传照样成功，没人会察觉，
        直到换一种启动方式（容器 / 系统服务 / 别的 cwd）时文档又「凭空消失」。
        """
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = Path(REPO_ROOT) / path
        return normpath(str(path))

    class Config:
        extra = "ignore"
        env_file = ENV_FILE


try:
    settings = Settings()
except Exception as exc:  # noqa: BLE001
    # 缺 .env 时报的是「字段缺失」，一条也看不出其实只是还没复制模板；
    # 而 Settings() 在 import 期执行，所以这一下不接住，症状就是「main.py 导不进去」。
    raise RuntimeError(
        "后端配置不完整。先执行：cp apps/backend/.env.example apps/backend/.env，"
        "再按里面的说明填 SECRET_KEY / POSTGRE_ADDR / 模型 id。"
    ) from exc


# 弱密钥不写在 field_validator 里，是为了让它报的是「该怎么办」而不是 pydantic 的字段错误串。
_SECRET_KEY_MIN_LENGTH = 32


def _assert_secret_key_usable(value: str) -> None:
    problems = []
    if not value or value.startswith(("replace-me", "change-me", "your-")):
        problems.append("还是 .env.example 里的占位值")
    if len(value) < _SECRET_KEY_MIN_LENGTH:
        problems.append(f"长度只有 {len(value)} 字符（要求 ≥{_SECRET_KEY_MIN_LENGTH}）")
    distinct = len(set(value))
    if distinct <= 8:
        problems.append(f"只用了 {distinct} 种不同字符，重复度过高")
    if problems:
        # 这条闸门发生在任何请求之前：HS256 的签名强度取决于密钥熵，
        # 10 字符 / 8 种字符的密钥是可以被离线爆破的，而它签发的是「管理员」身份。
        raise RuntimeError(
            "SECRET_KEY 不合格，拒绝启动：" + "；".join(problems)
            + "。生成一个：python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            "，写进 apps/backend/.env 的 SECRET_KEY。"
            "换密钥会让所有已签发的 token 失效，所有人需要重新登录。"
        )


_assert_secret_key_usable(settings.secret_key)


def _assert_doc_addr_usable(value: str) -> None:
    """DOC_ADDR 必须现在就可用，而不是等到第一次上传才发现。

    创建目录这件事上传路径本来就会做，但那时它埋在一条 500 + 追踪码里，
    看不出是「权限不够」还是「路径写错了」。放在启动期：目录建不出来就直接拒绝启动，
    并把该改哪个键说清楚。
    """
    path = Path(value)
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError(
            f"DOC_ADDR 指向的目录创建不了：{path}（{exc}）。"
            "改掉 apps/backend/.env 里的 DOC_ADDR，指向一个这个进程可写的绝对路径。"
        ) from exc
    if not access(path, W_OK | X_OK):
        raise RuntimeError(
            f"DOC_ADDR 目录存在但不可写：{path}。"
            "给运行后端的用户加上写权限，或把 DOC_ADDR 换到别的目录。"
        )


_assert_doc_addr_usable(settings.doc_addr)


@lru_cache()
def get_settings():
    return Settings()


locals().update(settings.model_dump())

__all__ = list(settings.model_dump().keys()) + ["settings"]
