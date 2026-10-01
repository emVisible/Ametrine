from asyncio import Semaphore
from enum import Enum
from functools import lru_cache
from threading import Lock
from time import monotonic
from typing import AsyncGenerator, Dict

from langchain_core.embeddings import Embeddings
from langchain_experimental.text_splitter import SemanticChunker
from huggingface_hub import snapshot_download
from pymilvus import MilvusClient
from redis import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from transformers import AutoTokenizer
from xinference_client import RESTfulClient

from .config import (
    chunk_overlap,
    chunk_size,
    milvus_host,
    milvus_port,
    postgre_addr,
    postgre_log,
    redis_db,
    redis_host,
    redis_password,
    redis_port,
    semantic_splitter,
    semaphore,
    xinference_addr,
    xinference_api_key,
    tokenizer_addr,
)
from .inference import auth, bindings
from .inference.errors import ModelUnavailable, XinferenceUnavailable
from .middleware.logger import config_logger
from .vector.documents.splitter import BoundedChunker

engine = create_async_engine(postgre_addr, echo=bool(postgre_log))
async_session = async_sessionmaker(engine, expire_on_commit=False)
Base = declarative_base()

# 共享的 xinference 客户端 —— **第一次用到时才建**，模块导入期不碰网络。
#
# 以前这里是 `client = RESTfulClient(...)`。3.x 客户端的构造函数会立刻打一次
# `/v1/cluster/auth` 探测鉴权（`xinference_client/client/restful/restful_client.py:1177`
# → `_check_cluster_authenticated`），于是 `import src.client` 变成一次网络调用。
# 后果是实测到的：`dev.sh` 里后端与推理服务并行起，推理服务还没监听时那条探测拿到的是
# 代理替我们回的 502（HTML），库里的 `response.json()['detail']` 直接抛
# `requests.exceptions.JSONDecodeError` —— **整个应用在 import 阶段就死**，
# 而 dev.sh 顶部明明写着「模型没起来也照样把后端拉起来」。那句承诺要有个惰性才成立。
#
# 惰性化之后：后端任何时候都能起来；推理不可用只会在真正用到时变成一条 503
# （`XinferenceUnavailable`），而不是「后端起不来 + 一句看不懂的 JSON 解析错」。
_client: RESTfulClient | None = None
_client_lock = Lock()
_shared_token: str | None = None


def get_client() -> RESTfulClient:
    global _client
    # 推理面不经过 `auth.bearer()`，句柄里的 `_headers` 只是登录那一刻推进去的快照；
    # 没人续期的话，服务器默认那 30 分钟一过，每条推理都 401（而 401 过去还会被翻成
    # 「模型不可用」）。续期点放在这个唯一的取句柄出口上：一次时间比较，临近过期才登录。
    auth.ensure_fresh()
    if _client is None:
        with _client_lock:
            if _client is None:
                try:
                    built = RESTfulClient(
                        base_url=xinference_addr, api_key=xinference_api_key or None
                    )
                except Exception as exc:  # noqa: BLE001 构造即探测，失败要说清是谁的锅
                    raise XinferenceUnavailable(
                        f"连不上推理服务器 {xinference_addr}（{type(exc).__name__}: "
                        f"{str(exc)[:160]}）。它没起来时后端照样可用，"
                        "只是 /api/chat、/api/llm/rag 这类推理接口会 503。"
                    ) from exc
                if _shared_token:
                    built._set_token(_shared_token)  # noqa: SLF001
                _client = built
    return _client


def get_model_handle(model_uid: str):
    """取一个模型句柄，并且**把凭据被拒和模型不存在分开说**。

    以前这两件事共用一条出口：任何异常都翻成 `ModelUnavailable` ⇒ 一句
    「请去管理台加载它」。实测过那条弯路有多贵 —— 服务器其实答得好好的，
    只是不接受我们这份过期 token，而界面把运维指回了一个本来就在运行的模型。
    """
    try:
        return get_client().get_model(model_uid=model_uid)
    except XinferenceUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001
        if not auth.looks_like_auth_rejection(str(exc)):
            raise
        # 过期是最常见的原因，而重签对用户是免费的：再试一次
        auth.bearer(force=True)
        try:
            return get_client().get_model(model_uid=model_uid)
        except Exception as retry_exc:  # noqa: BLE001
            if not auth.looks_like_auth_rejection(str(retry_exc)):
                raise
            raise XinferenceUnavailable(
                "xinference 拒绝了后端的凭据（401），强制重签之后仍然被拒。"
                "检查 .env 的 XINFERENCE_ADMIN_USER / XINFERENCE_ADMIN_PASSWORD，"
                "或在管理台「模型推理」页点「重新登录」。"
            ) from retry_exc


def peek_client() -> RESTfulClient | None:
    """已经建好就返回，没建好**不会**去建（给就绪探针/自检看状态用）。"""
    return _client


def set_shared_token(token: str | None) -> None:
    """把 JWT 记下来并打到共享句柄上；句柄还没建时，等它建起来的那一刻补上。

    两边都要做是有原因的：只 `if _client: _client._set_token(...)` 的话，
    「先登录、后第一次推理」这条顺序会让新建的句柄**不带凭据**，
    于是每条推理都 401 —— 而 401 在客户端看起来和「口令错了」一模一样。
    """
    global _shared_token, _client
    _shared_token = token
    if _client is not None and token:
        _client._set_token(token)  # noqa: SLF001 —— CLI 自己也是这么用的


_semaphore_pool: Dict[int, Semaphore] = {}


async def get_milvus_service():
    return MilvusClient(host=milvus_host, port=milvus_port)


async def get_relation_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


@lru_cache()
def get_redis() -> Redis:
    client = Redis(
        host=redis_host,
        port=redis_port,
        db=redis_db,
        password=redis_password or None,
        decode_responses=True,
    )
    try:
        client.ping()
    except Exception as e:
        raise RuntimeError(
            f"Redis 连接失败：{redis_host}:{redis_port} db={redis_db}。"
            "对一下 apps/backend/.env 的 REDIS_HOST / REDIS_PORT / REDIS_DB / REDIS_PASSWORD，"
            "并确认这个 Redis 真的在监听（docker compose -f apps/database/docker-compose.yml ps）。"
        ) from e
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
                self._handle = get_model_handle(self._model_uid)
            except XinferenceUnavailable:
                # 凭据的事不是「模型不可用」，别把它改写成一句让人去重载模型的假建议
                raise
            except Exception as e:  # noqa: BLE001
                # 不是 RuntimeError：这条以前以 500 + 追踪码收场，而它其实是「依赖没就绪」。
                # 换成 ModelUnavailable 后统一回 503，并把该做什么写进 message。
                raise ModelUnavailable(self._model_uid, reason=str(e)) from e
        return self._handle

    def __getattr__(self, name):
        return getattr(self.resolve(), name)


# 角色 → 句柄缓存。键里带 uid，所以「换走再换回上一个模型」不会拿到一个
# 绑着旧 uid 的对象；改绑定时整个清掉（见 invalidate_model_handles）。
_handle_cache: Dict[str, object] = {}


def _bound_handle(role: str, factory):
    uid = bindings.current(role)
    key = f"{role}:{uid}"
    handle = _handle_cache.get(key)
    if handle is None:
        handle = factory(uid)
        _handle_cache[key] = handle
    return handle


def invalidate_model_handles() -> None:
    """换绑定之后必须丢掉句柄，以及**依赖句柄的 splitter**。

    以前 `get_rerank_model()` / `get_embedding_model()` 是 `@lru_cache`：
    换完绑定界面显示的是新模型，请求却还在用旧句柄 —— 和 `crossBase` 漏在
    `useCallback` 依赖数组里是同一类「界面撒谎」。
    `get_splitter()` 也带 `@lru_cache`，而语义切分器内部持有 embedding 句柄，
    所以只清句柄的话分块边界仍按旧模型走，一并清掉。
    """
    _handle_cache.clear()
    get_splitter.cache_clear()


# 由 `bindings.set_binding` 在写库之后调用。挂在注册表上而不是让路由自己记得清，
# 是因为「谁记得谁负责」正是第二个事实源的成因。
bindings.register_invalidator(invalidate_model_handles)


def get_llm_model():
    return _bound_handle("llm", LazyModelHandle)


def get_rerank_model():
    return _bound_handle("rerank", LazyModelHandle)


class CredentialedEmbeddings(Embeddings):
    """走共享 `client` 的向量化入口。

    换掉 langchain 的 XinferenceEmbeddings 的原因：它内部自己 `RESTfulClient(server_url)`，
    构造签名里没有 api_key（实测只有 server_url/model_uid），xinference 3.x 一开鉴权必然 401。
    请求语义与它保持一致（一条文本一次 /v1/embeddings 调用），只把出口换成会带 Authorization 的那个 client。
    """

    def __init__(self, model_uid: str):
        self.model_uid = model_uid

    def _embed_one(self, text: str) -> list[float]:
        res = get_model_handle(self.model_uid).create_embedding(text)
        return list(map(float, res["data"][0]["embedding"]))

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed_one(text)


def get_embedding_model():
    return _bound_handle("embedding", CredentialedEmbeddings)


class TokenizerUnavailable(Exception):
    """分词器既不在本地缓存、也下载不到。

    它决定 prompt 预算（`max_model_len` 的截断按 token 数算），所以**不能**用字符估算蒙混 ——
    那会把「预算没算准」变成静默的上下文溢出。这里选择明确失败：503 + 原因 + Retry-After。
    """

    def __init__(self, message: str, retry_after: float = 0.0):
        super().__init__(message)
        self.retry_after = max(0.0, retry_after)


# 失败冷却：lru_cache 不缓存异常，所以「HF 不可达」在原先是**每个请求**重付一次下载重试
# —— 本机实测 69 秒之后回一个什么信息都没有的 500。冷却期内直接用同一个原因失败。
_TOKENIZER_RETRY_AFTER = 600.0
# 只要分词器那几个人手文件：写宽了会顺手把几 GB 的权重拖下来。
_TOKENIZER_FILES = (
    "tokenizer_config.json",
    "tokenizer.json",
    "vocab.json",
    "merges.txt",
    "special_tokens_map.json",
    "added_tokens.json",
    "tokenizer.model",
    "chat_template.jinja",
)
_tokenizer_blocked_until = 0.0
_tokenizer_last_error = ""
_tokenizer_lock = Lock()


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

    global _tokenizer_blocked_until, _tokenizer_last_error
    with _tokenizer_lock:
        remaining = _tokenizer_blocked_until - monotonic()
        if remaining > 0:
            raise TokenizerUnavailable(
                f"分词器 {tokenizer_addr} 不可用：{_tokenizer_last_error} "
                f"冷却期内不再尝试下载，约 {int(remaining)} 秒后重试。",
                retry_after=remaining,
            )

        # 本地优先，而且**必须**是「先解析出本地目录再交给 transformers」。
        # 实测对比（本机 HF 不可达）：
        #   AutoTokenizer.from_pretrained(hub_id, local_files_only=True) → 仍然打
        #     `GET /api/models/<id>`，5.6 秒后才失败；
        #   snapshot_download(hub_id, local_files_only=True, allow_patterns=分词器文件)
        #     → 0.001 秒拿到快照目录，再 from_pretrained(目录) 0.646 秒得到
        #     Qwen2TokenizerFast(vocab=151643)，全程零网络请求。
        # 也就是说一份本地已经齐备的资源，原先被一次不必要的新鲜度探测挡在了网络后面，
        # 而那次探测在离线机器上就是「每个请求 69 秒然后 500」。
        # allow_patterns 只取分词器那一小组文件，不会顺手把几 GB 权重拖下来。
        source = None
        if isdir(tokenizer_addr):
            source = tokenizer_addr
        else:
            try:
                source = snapshot_download(
                    tokenizer_addr,
                    local_files_only=True,
                    allow_patterns=list(_TOKENIZER_FILES),
                )
            except Exception:  # noqa: BLE001 缓存里没有 ⇒ 走下面那次真实下载
                source = None

        if source is not None:
            return AutoTokenizer.from_pretrained(source)

        try:
            source = snapshot_download(
                tokenizer_addr, allow_patterns=list(_TOKENIZER_FILES)
            )
            tokenizer = AutoTokenizer.from_pretrained(source)
        except Exception as exc:  # noqa: BLE001
            _tokenizer_last_error = f"{type(exc).__name__}: {str(exc)[:120]}"
            _tokenizer_blocked_until = monotonic() + _TOKENIZER_RETRY_AFTER
            config_logger.error(
                "tokenizer unavailable for %s, backing off %.0fs: %s",
                tokenizer_addr,
                _TOKENIZER_RETRY_AFTER,
                exc,
            )
            raise TokenizerUnavailable(
                f"分词器 {tokenizer_addr} 既不在本地缓存也下载不到（{_tokenizer_last_error}）。"
                "把分词器下到本地目录并把 TOKENIZER_ADDR 指过去，或配好 HF_ENDPOINT 镜像后重试。"
            ) from exc
        _tokenizer_blocked_until = 0.0
        _tokenizer_last_error = ""
        return tokenizer


@lru_cache()
def get_splitter():
    """入库用的分块器。`SEMANTIC_SPLITTER` 现在只改「超长段落怎么切」这一件事，
    而 `CHUNK_SIZE` / `CHUNK_OVERLAP` 在两条路上都是硬上限（旧的语义路径里它们完全不参与，
    配置写的是 512、实测切出过 1,409 字的块）。

    语义切分器**要等到真的遇到超长段落才构造**：以前这里是无条件
    `SemanticChunker(get_embedding_model(), ...)`，于是「只装了 LLM、没装 embedding」的
    部署在入库第一步就炸，而它本来一次向量都不需要。
    """

    def _semantic_factory():
        return SemanticChunker(
            get_embedding_model(),
            breakpoint_threshold_type="gradient",
            # 默认断句正则 `(?<=[.?!])\s+` 要求标点后跟空白，中文「。」后无空格，
            # 整篇文档会被当作 1 个句子直接原样返回（即一篇文档 = 1 个 chunk = 1 条向量）。
            sentence_split_regex=r"(?<=[.?!。？！;；])\s*",
        )

    return BoundedChunker(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        semantic=bool(semantic_splitter),
        semantic_factory=_semantic_factory if semantic_splitter else None,
        on_skip=lambda why: config_logger.warning("分块降级：%s", why),
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
