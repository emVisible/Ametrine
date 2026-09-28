from asyncio import Semaphore
from enum import Enum
from functools import lru_cache
from typing import AsyncGenerator, Dict

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.embeddings import XinferenceEmbeddings
from langchain_experimental.text_splitter import SemanticChunker
from langchain_xinference import ChatXinference
from pymilvus import MilvusClient
from redis import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from src.config import xinference_addr, xinference_llm_model_id
from transformers import AutoTokenizer
from xinference.client import RESTfulClient
from xinference.client.handlers import AudioModelHandle

from .config import (
    chunk_overlap,
    chunk_size,
    milvus_host,
    milvus_port,
    postgre_addr,
    postgre_log,
    semantic_splitter,
    semaphore,
    xinference_addr,
    xinference_embedding_model_id,
    xinference_llm_model_id,
    xinference_rerank_model_id,
    xinference_stt_model_id,
    tokenizer_addr,
)

engine = create_async_engine(postgre_addr, echo=bool(postgre_log))
async_session = async_sessionmaker(engine, expire_on_commit=False)
Base = declarative_base()

client = RESTfulClient(base_url=xinference_addr)

_semaphore_pool: Dict[int, Semaphore] = {}


async def get_milvus_service():
    return MilvusClient(host=milvus_host, port=milvus_port)


async def get_relation_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


async def reset_relation_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


@lru_cache()
def get_redis() -> Redis:
    client = Redis(host="127.0.0.1", port=6379, db=0, decode_responses=True)
    try:
        client.ping()
    except Exception as e:
        raise RuntimeError("Redis connection failed!") from e
    return client


def get_llm_model():
    return client.get_model(model_uid=xinference_llm_model_id)


@lru_cache()
def get_rerank_model():
    return client.get_model(model_uid=xinference_rerank_model_id)


@lru_cache()
def get_embedding_model():
    return XinferenceEmbeddings(
        server_url=xinference_addr, model_uid=xinference_embedding_model_id
    )


@lru_cache()
def get_stt_handle() -> AudioModelHandle:
    return client.get_model(model_uid=xinference_stt_model_id)


@lru_cache()
def get_tokenizer():
    return AutoTokenizer.from_pretrained(tokenizer_addr)


@lru_cache()
def get_splitter():
    if semantic_splitter:
        return SemanticChunker(
            get_embedding_model(),
            breakpoint_threshold_type="gradient",
            # 默认断句正则 `(?<=[.?!])\s+` 要求标点后跟空白，中文「。」后无空格，
            # 整篇文档会被当作 1 个句子直接原样返回（即一篇文档 = 1 个 chunk = 1 条向量）。
            sentence_split_regex=r"(?<=[.?!。？！;；])\s*",
        )
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=chunk_overlap
    )


class TaskType(str, Enum):
    LLM = "llm"
    RAG = "rag"

    @property
    def weight(self) -> float:
        if self == TaskType.LLM:
            return 1.0
        elif self == TaskType.RAG:
            return 0.8


def get_semaphore(task_type: TaskType) -> Semaphore:
    if task_type.value not in _semaphore_pool:
        permits = max(1, int(semaphore * task_type.weight))
        _semaphore_pool[task_type.value] = Semaphore(permits)
    return _semaphore_pool[task_type.value]
