from asyncio import Lock
from functools import lru_cache
from typing import AsyncGenerator

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.embeddings import XinferenceEmbeddings
from langchain_experimental.text_splitter import SemanticChunker
from pymilvus import MilvusClient
from redis import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from transformers import AutoTokenizer
from xinference.client import RESTfulClient

from .config import (
    chunk_overlap,
    chunk_size,
    postgre_addr,
    postgre_log,
    semantic_splitter,
    xinference_addr,
    xinference_embedding_model_id,
    xinference_llm_model_id,
    xinference_rerank_model_id,
    xinference_stt_model_id
)


# Milvus Client
async def get_milvus_service():
    return MilvusClient(host="127.0.0.1", port="19530")


# PostgreSQL Client
engine = create_async_engine(postgre_addr, echo=bool(postgre_log))
async_session = async_sessionmaker(engine, expire_on_commit=False)
Base = declarative_base()


async def get_relation_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


async def reset_relation_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


# Redis Client
@lru_cache()
def get_redis() -> Redis:
    client = Redis(host="127.0.0.1", port=6379, db=0, decode_responses=True)
    try:
        client.ping()
    except Exception as e:
        raise RuntimeError("Redis connection failed!") from e
    return client


""" Xinference client """
model_lock = Lock()
client = RESTfulClient(base_url=xinference_addr)


@lru_cache()
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
def get_stt_model():
  return client.get_model(model_uid=xinference_stt_model_id)


@lru_cache()
def get_tokenizer():
    return AutoTokenizer.from_pretrained(
        "/root/.cache/modelscope/hub/models/qwen/Qwen2___5-0___5B-Instruct"
    )


@lru_cache()
def get_splitter():
    if semantic_splitter:
        return SemanticChunker(
            get_embedding_model(), breakpoint_threshold_type="gradient"
        )
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=chunk_overlap
    )
