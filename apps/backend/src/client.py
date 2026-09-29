from asyncio import Semaphore
from enum import Enum
from functools import lru_cache
from typing import AsyncGenerator, Dict

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.embeddings import Embeddings
from langchain_experimental.text_splitter import SemanticChunker
from pymilvus import MilvusClient
from redis import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from src.config import xinference_addr, xinference_llm_model_id
from transformers import AutoTokenizer
from xinference_client import RESTfulClient

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
    xinference_api_key,
    xinference_embedding_model_id,
    xinference_llm_model_id,
    xinference_rerank_model_id,
    xinference_stt_model_id,
    tokenizer_addr,
)

engine = create_async_engine(postgre_addr, echo=bool(postgre_log))
async_session = async_sessionmaker(engine, expire_on_commit=False)
Base = declarative_base()

# 3.x 服务器强制鉴权，这里先把密钥通道接上；留空时 api_key=None，2.10 行为不变。
client = RESTfulClient(base_url=xinference_addr, api_key=xinference_api_key or None)

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


class LazyModelHandle:
    """把 `get_model` 的服务端往返推到第一次真正用到时。

    3.x 客户端的 `get_model` 是即时的（实测会 `RuntimeError: Failed to get the model
    description … Model not found in the model list`），而 `get_llm_service` 每条请求都要
    注入 llm / rerank 两个句柄 —— 于是「只装了 LLM、没装 rerank」的机器上，
    纯 LLM 对话（根本不走 rerank）也会在依赖注入阶段炸 500。
    惰性化之后：用到才解析，没装就在使用它的那条路径上报错，语义与「服务端没这个模型」一致。
    """

    def __init__(self, model_uid: str):
        self._model_uid = model_uid
        self._handle = None

    @property
    def model_uid(self) -> str:
        return self._model_uid

    def resolve(self):
        if self._handle is None:
            try:
                self._handle = client.get_model(model_uid=self._model_uid)
            except Exception as e:
                raise RuntimeError(
                    f"Xinference 上没有可用的模型「{self._model_uid}」：{e}。"
                    "先跑 scripts/load_models.sh，或把 .env 里的模型 id 改成实际加载的那个。"
                ) from e
        return self._handle

    def __getattr__(self, name):
        return getattr(self.resolve(), name)


def get_llm_model():
    return LazyModelHandle(xinference_llm_model_id)


@lru_cache()
def get_rerank_model():
    return LazyModelHandle(xinference_rerank_model_id)


class CredentialedEmbeddings(Embeddings):
    """走共享 `client` 的向量化入口。

    换掉 langchain 的 XinferenceEmbeddings 的原因：它内部自己 `RESTfulClient(server_url)`，
    构造签名里没有 api_key（实测只有 server_url/model_uid），xinference 3.x 一开鉴权必然 401。
    请求语义与它保持一致（一条文本一次 /v1/embeddings 调用），只把出口换成会带 Authorization 的那个 client。
    """

    def __init__(self, model_uid: str):
        self.model_uid = model_uid

    def _embed_one(self, text: str) -> list[float]:
        res = client.get_model(model_uid=self.model_uid).create_embedding(text)
        return list(map(float, res["data"][0]["embedding"]))

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed_one(text)


@lru_cache()
def get_embedding_model():
    return CredentialedEmbeddings(xinference_embedding_model_id)


@lru_cache()
def get_stt_handle() -> LazyModelHandle:
    return LazyModelHandle(xinference_stt_model_id)


@lru_cache()
def get_tokenizer():
    # TOKENIZER_ADDR 既可以是本地目录也可以是 hub id。写成绝对路径但目录不存在时，
    # transformers 会把它当 repo id 再校验一次，抛出
    # `HFValidationError: Repo id must be in the form 'repo_name' or 'namespace/repo_name'`
    # —— 这条报错完全不提 TOKENIZER_ADDR，会让人以为是网络或 HF 的问题
    # （本机就是这样：/api/chat 每个请求 500，而模型其实是好的）。
    from os.path import isdir, isabs

    if isabs(tokenizer_addr) and not isdir(tokenizer_addr):
        raise RuntimeError(
            f"TOKENIZER_ADDR 指向的目录不存在：{tokenizer_addr}。"
            "要么把权重/分词器下到该路径，要么改成 hub id（如 Qwen/Qwen2.5-3B-Instruct，"
            "配合 HF_ENDPOINT 镜像首次会联网下载一次）。"
        )
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
