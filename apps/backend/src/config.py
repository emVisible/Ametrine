from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    http_proxy: str = Field(default="", alias="HTTP_PROXY")
    https_proxy: str = Field(default="", alias="HTTPS_PROXY")
    no_proxy: str = Field(default="localhost,127.0.0.1,.local", alias="NO_PROXY")

    algorithm: str = Field(..., alias="ALGORITHM")
    secret_key: str = Field(..., alias="SECRET_KEY")
    access_token_expire_minutes: int = Field(..., alias="ACCESS_TOKEN_EXPIRE_MINUTES")

    xinference_addr: str = Field(..., alias="XINFERENCE_MAIN_ADDR")
    # xinference 2.x 匿名可用；3.x 服务端强制鉴权（见 docs/refactor 那篇依赖分析）。
    # 留空 = 按匿名处理，所以现在这台 2.10 服务器不受影响。
    xinference_api_key: str = Field(default="", alias="XINFERENCE_API_KEY")
    xinference_llm_model_id: str = Field(..., alias="XINFERENCE_LLM_MODEL_ID")
    xinference_embedding_model_id: str = Field(
        ..., alias="XINFERENCE_EMBEDDING_MODEL_ID"
    )
    embedding_dimension: int = Field(default=1024, alias="EMBEDDING_DIMENSION")
    xinference_rerank_model_id: str = Field(..., alias="XINFERENCE_RERANK_MODEL_ID")
    tokenizer_addr: str = Field(..., alias="TOKENIZER_ADDR")

    db_addr: str = Field(..., alias="DB_ADDR")
    milvus_host: str = Field(default="127.0.0.1", alias="MILVUS_HOST")
    milvus_port: str = Field(default="19530", alias="MILVUS_PORT")
    milvus_metric_type: str = Field(default="L2", alias="MILVUS_METRIC_TYPE")
    milvus_index_type: str = Field(default="IVF_FLAT", alias="MILVUS_INDEX_TYPE")
    milvus_index_nlist: int = Field(default=256, alias="MILVUS_INDEX_NLIST")
    doc_addr: str = Field(..., alias="DOC_ADDR")
    k: int = Field(..., alias="K")
    p: int = Field(..., alias="P")
    min_relevance_score: float = Field(..., alias="MIN_RELEVANCE_SCORE")
    chunk_size: int = Field(..., alias="CHUNK_SIZE")
    chunk_overlap: int = Field(..., alias="CHUNK_OVERLAP")
    max_model_len: int = Field(..., alias="MAX_MODEL_LEN")
    postgre_addr: str = Field(..., alias="POSTGRE_ADDR")
    postgre_log: bool = Field(..., alias="POSTGRE_LOG")

    semantic_splitter: bool = Field(..., alias="SEMANTIC_SPLITTER")
    ocr_agent: str = Field(..., alias="OCR_AGENT")

    semaphore: int = Field(..., alias="SEMAPHORE")

    class Config:
        extra = "ignore"
        env_file = ".env"


try:
    settings = Settings()
except Exception as exc:  # noqa: BLE001
    # 缺 .env 时报的是「字段缺失」，一条也看不出其实只是还没复制模板；
    # 而 Settings() 在 import 期执行，所以这一下不接住，症状就是「main.py 导不进去」。
    raise RuntimeError(
        "后端配置不完整。先执行：cp apps/backend/.env.example apps/backend/.env，"
        "再按里面的说明填 SECRET_KEY / POSTGRE_ADDR / 模型 id。"
    ) from exc


@lru_cache()
def get_settings():
    return Settings()


locals().update(settings.model_dump())

__all__ = list(settings.model_dump().keys()) + ["settings"]
