from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    algorithm: str = Field(..., alias="ALGORITHM")
    secret_key: str = Field(..., alias="SECRET_KEY")
    access_token_expire_minutes: int = Field(..., alias="ACCESS_TOKEN_EXPIRE_MINUTES")

    xinference_addr: str = Field(..., alias="XINFERENCE_MAIN_ADDR")
    xinference_vice_addr: str = Field(..., alias="XINFERENCE_VICE_ADDR")
    xinference_llm_model_id: str = Field(..., alias="XINFERENCE_LLM_MODEL_ID")
    xinference_embedding_model_id: str = Field(
        ..., alias="XINFERENCE_EMBEDDING_MODEL_ID"
    )
    xinference_rerank_model_id: str = Field(..., alias="XINFERENCE_RERANK_MODEL_ID")
    xinference_stt_model_id: str = Field(..., alias="XINFERENCE_STT_MODEL_ID")

    db_addr: str = Field(..., alias="DB_ADDR")
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
    web_search_summary_limit: int = Field(..., alias="WEB_SEARCH_SUMMARY_LIMIT")

    semaphore: int = Field(..., alias="SEMAPHORE")

    class Config:
        extra = "ignore"
        env_file = ".env"


settings = Settings()


@lru_cache()
def get_settings():
    return Settings()


locals().update(settings.model_dump())

__all__ = list(settings.model_dump().keys()) + ["settings"]
