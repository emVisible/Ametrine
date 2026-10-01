# src/relation/documents/controller.py
from hashlib import sha256
from pathlib import Path
from time import time
from uuid import UUID, uuid4

import anyio

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from pymilvus import MilvusClient
from src.client import get_embedding_model, get_milvus_service
from src.config import doc_addr, max_upload_bytes, xinference_embedding_model_id
from src.llm.service import LLMService, get_llm_service
from src.middleware.logger import config_logger
from src.middleware.tags import ControllerTag
from src.relation.collections.service import CollectionService, get_collection_service
from src.relation.databases.service import DatabaseService, get_database_service
from src.user.auth.service import get_current_user
from src.user.permissions.service import PermissionService, get_permission_service
from src.utils.other import use_vector_database
from src.vector.documents.service import (
    DocumentService as VectorDocumentService,
    get_document_service as get_vector_document_service,
)
from src.vector.documents.loader import LOADER_MAPPING, ParserUnavailable, process_documents
from .service import DocumentService, get_document_service

route_document = APIRouter(prefix="/document", tags=[ControllerTag.relation_db])

# 扩展名走**白名单**，而且白名单直接取自解析器真正认识的类型（LOADER_MAPPING）：
# 列一份解析器不支持的类型等于对外承诺了一个会在后台失败的能力。
_ALLOWED_EXTENSIONS = frozenset(LOADER_MAPPING)
_CHUNK = 64 * 1024


def _parse_and_embed(file_path: str, embedding_model):
    """解析 + 逐块嵌入，**同步**函数，只能从 `anyio.to_thread.run_sync` 里调。

    合成一个函数而不是分两次进线程，是因为解析本身也是阻塞的（unstructured 要真的读文件、
    跑正则与切分），分两次等于把循环冻两回，而中间那次还没有任何进展可报告。
    """
    chunks = process_documents(is_multiple=False, file_path=file_path)
    embeddings = embedding_model.embed_documents([c.page_content for c in chunks])
    return chunks, embeddings

# 写入路径的失败语义**只有一份**，上传与重建共用（两者是同一件事的两次入口：一份原文 → 一套分块与向量）。
# 不写进 OpenAPI 的失败码等于没写：客户端按 spec 生成的错误分支里只有 422，
# 而真实世界里 409/415/501/502 的处置方式完全不同（重传 / 换类型 / 装依赖 / 等模型）。
_INGEST_FAILURE_RESPONSES = {
    401: {"description": "未登录"},
    403: {"description": "对该知识库没有写权限"},
    404: {"description": "库 / 集合 / 文档不存在"},
    409: {"description": "内容重复（上传）；原文已不在磁盘上，无法重做（重建）"},
    413: {"description": "超过 MAX_UPLOAD_BYTES"},
    415: {"description": "扩展名不在解析白名单里"},
    501: {"description": "白名单里有这个类型，但这套部署缺解析依赖（detail 点名缺什么）"},
    502: {"description": "embedding 模型或向量库不可用（上游故障，不是解析失败）"},
}


class _TooLarge(Exception):
    """流式落盘时越过了 MAX_UPLOAD_BYTES。单独一个类型，好和别的失败分开报。"""


def _resolve_stored_path(stored: str | None) -> Path | None:
    """把 meta.stored_path 解析成一个真实路径。

    新数据存的是相对 DOC_ADDR 的路径；旧数据存的是当时的绝对路径，
    换目录或换机器就整体失效（本机 6 篇文档正是这样：路径在、文件不在）。
    所以绝对路径解析不到时，再按文件名到 DOC_ADDR 下试一次。
    """
    if not stored:
        return None
    candidate = Path(stored)
    if candidate.is_absolute():
        if candidate.is_file():
            return candidate
        candidate = Path(doc_addr) / candidate.name
    else:
        candidate = Path(doc_addr) / candidate
    return candidate if candidate.is_file() else None


def _doc_readmodel(document) -> dict:
    """文档的对外形状：ORM 字段 + 派生的 `source_available`，并且把异常原文摘掉。

    `source_available` 每次现算，不存列 —— 存了就必须靠某个写入方记得更新它，
    而这正是 token 用量那两个死列的成因（R1）。
    `meta.index_error` 里是历史失败留下的 `str(e)`，连接串与绝对路径都可能在其中，
    而它会被 /all 与 /get 原样发给客户端（R5）：这里换成类型名，细节只在日志里。
    """
    meta = dict(document.meta or {})
    error = meta.pop("index_error", None)
    if error and "index_error_type" not in meta:
        meta["index_error_type"] = _error_type_hint(error)
    resolved = _resolve_stored_path(meta.get("stored_path"))
    return {
        "id": str(document.id),
        "title": document.title,
        "uploader": document.uploader,
        "created_at": document.created_at,
        "collection_id": document.collection_id,
        "meta": meta,
        # 原文丢了就意味着这篇永远无法重新切分或换模型重索引，
        # 界面必须能看出来，而不是等用户点「重建」才发现。
        "source_available": resolved is not None,
    }


def _error_type_hint(raw: str) -> str:
    """从历史遗留的异常文本里只取类型名（形如 `ValueError: xxx` / 纯消息）。"""
    head = str(raw).split("\n", 1)[0]
    token = head.split(":", 1)[0].strip()
    return token if token[:1].isupper() and token.isidentifier() else "error"


# 「可直接重试」这句安慰以前是按异常**类型**说的：只要 Milvus 抛 MilvusException 就劝人重试。
# 实测到一个不会自愈的例子：一个被错归到别的库的文档，删除永远回 502，
# 而真因是向量侧根本没有那个集合 —— 重试一百次也不会把它变出来。
# 这句话该不该说，必须由失败原因决定，不能由它的类别决定。
_UNRECOVERABLE_HINTS = (
    "collection not exist",
    "collection not found",
    "can't find collection",
    "invalid collection name",
    "database not exist",
    "database not found",
)


def _vector_delete_advice(exc: BaseException, untouched: str) -> str:
    """向量删除失败时该说什么：能重试就明说，重试不了的要把「为什么重试不了」讲出来。"""
    haystack = str(exc).lower()
    if any(h in haystack for h in _UNRECOVERABLE_HINTS):
        return (
            f"{untouched}，但**重试不会让它成功**：向量侧没有那个集合/库。"
            "这行的归属与向量库已经不一致（多半是它当初被写进了另一个知识库名下），"
            "需要人工核对它的 database_name 与 collection_name"
        )
    return f"{untouched}，PG 记录完整，可以直接重试"


def _ensure_loaded(milvus, collection_name: str) -> None:
    """删向量之前先把集合装载起来。

    Milvus 的 `delete` 要求集合处于 loaded 状态，否则回
    `MilvusException: collection not loaded[collection=…]`。检索那条路在
    `vector/documents/service.py:68` 已经做了 `load_collection`（幂等，实测约 8 ms），
    而删除路径没有 —— 后果是**服务重启之后、任何没被最近一次检索碰过的知识库都删不掉文档**，
    而界面还会说「可直接重试」，重试一万次也不会好，因为缺的不是重试而是一次装载。
    （本机实测：删一篇刚上传的 EPUB 就 502，原文与 PG 行都留在原地。）
    """
    try:
        milvus.load_collection(collection_name=collection_name)
    except Exception as exc:  # noqa: BLE001
        # 装载失败不改变「删除会怎么做」：让它照原样去 delete，
        # 真正的失败由下面的 except 如实报出去，而不是在这里换一种说法。
        config_logger.warning("load_collection(%s) 失败，继续尝试删除：%s",
                              collection_name, str(exc)[:160])


# ═══════════════════════════════════════════
# 查询接口（只读 PG）
# ═══════════════════════════════════════════


async def _readable_database_ids(
    current_user, perm_service: PermissionService
) -> list[int]:
    """当前用户可读的库 id；管理员拿到的是全量，所以这条路对两种身份都只有一份语义。"""
    return [db["id"] for db in await perm_service.get_accessible_databases(current_user.id)]


@route_document.get("/all", summary="获取所有Document（限可读库）")
async def all_documents(
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: DocumentService = Depends(get_document_service),
):
    # 这四个只读路由原先挂在「登录后就放行」下面，没有任何库级判断：
    # 换一个大一点的 document_id / doc_id 就能读到别人知识库的清单和全文，
    # 而 /relation/document/all 直接把全租户的文档一次性倒给任何人。
    # 知识库控制台对所有登录用户开放，所以按可读库过滤，而不是整条只留给管理员。
    ids = await _readable_database_ids(current_user, perm_service)
    documents = await service.document_get_all_service(database_ids=ids)
    return [_doc_readmodel(document) for document in documents]


@route_document.get("/collection", summary="获取指定Collection下的Documents（限可读库）")
async def get_specific(
    collection_id: int,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: DocumentService = Depends(get_document_service),
):
    ids = await _readable_database_ids(current_user, perm_service)
    documents = await service.document_get_by_collection_service(
        collection_id=collection_id, database_ids=ids
    )
    return [_doc_readmodel(document) for document in documents]


@route_document.get("/chunk/stats", summary="集合内每个文档的分块计数")
async def chunk_stats(
    collection_id: int,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: DocumentService = Depends(get_document_service),
):
    """(总块数, 参与检索的块数) 现算，不读 document.meta.chunk_count。

    那个字段是上传时写死的一次性数字：删掉一块之后它不会自己变小，
    界面要是信它，就会长期显示一个没人核对过的计数。
    """
    located = await service.collection_locate_service(collection_id=collection_id)
    await perm_service.require_read_database(
        current_user.id, located["database_name"]
    )
    return await service.chunk_stats_by_collection_service(collection_id=collection_id)


@route_document.get("/get", summary="获取Document详情")
async def get(
    document_id: str,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: DocumentService = Depends(get_document_service),
):
    if not await perm_service.can_access_document(current_user.id, document_id):
        raise HTTPException(status_code=403, detail="您无权访问该文档所属知识库")
    document = await service.document_get_service(document_id=document_id)
    return None if document is None else _doc_readmodel(document)


@route_document.get("/chunk", summary="获取Document的所有Chunks")
async def get_chunks(
    doc_id: str,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: DocumentService = Depends(get_document_service),
):
    # 返回的行带 enabled 字段：停用中的分块也要能列出来，否则没法再把它打开。
    if not await perm_service.can_access_document(current_user.id, doc_id):
        raise HTTPException(status_code=403, detail="您无权访问该文档所属知识库")
    return await service.chunk_get_by_document_service(doc_id=doc_id)


# ═══════════════════════════════════════════
# 上传接口（PG → Milvus）
# ═══════════════════════════════════════════

def _collection_fields(milvus: MilvusClient, collection_name: str) -> set[str]:
    collection = milvus.describe_collection(collection_name=collection_name)
    return {field["name"] for field in collection.get("fields", [])}


@route_document.post(
    "/upload",
    summary="上传文档（PG → Milvus 同步）",
    responses=_INGEST_FAILURE_RESPONSES,
)
async def upload_document(
    collection_name: str = Form(...),
    database_name: str = Form(default="default"),
    file: UploadFile = File(...),
    # 上传是写操作，原来却完全不认人：任何登录用户（甚至按旧代码是任何人）
    # 都能往任意集合里塞文档，而且 uploader 一律写死成 "admin"，
    # 事后既查不到是谁传的，也没法按人审计。
    # 依赖顺序沿用 /api/llm 那条教训：鉴权与权限要排在会打 Milvus/模型的依赖之前。
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
    collection_service: CollectionService = Depends(get_collection_service),
    # Milvus + LLM
    milvus: MilvusClient = Depends(get_milvus_service),
    # 入库只需要 embedding 句柄，不需要整个 LLMService —— 后者会把 get_tokenizer 一起拖进来：
    # 分词器不可用时（本机实测：HF 不可达，重试 5 次约 23 秒后抛错）依赖解析阶段就直接 500，
    # 于是白名单 415、超限 413、重复 409、缺解析器 501 一条都到不了，
    # 而每个请求都要重新付一次下载重试。切分与向量化本就与聊天分词器无关（同 707 行的召回测试）。
    embedding_model=Depends(get_embedding_model),
):
    await perm_service.require_write_database(current_user.id, database_name)

    # ── 1. 类型白名单：先拒了再说，别把任意字节交给解析器 ──
    safe_filename = Path(file.filename or "upload.bin").name
    extension = Path(safe_filename).suffix.lower()
    if extension not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"不支持的文件类型「{extension or '无扩展名'}」。可接受："
                + " ".join(sorted(_ALLOWED_EXTENSIONS))
            ),
        )

    # 集合先查：放在写盘之前，这样「集合不存在」不会留下一个没人引用的文件
    collection = await collection_service.collection_get_service(name=collection_name)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found in PG")

    # `Collection.name` 是**全局唯一**（`models.py` 里 unique=True），不是「库内唯一」。
    # 而这里入参是一对 (database_name, collection_name)，只按名字解析就会把
    # 「库 A + 库 B 里的集合名」静默解析到 B 的集合上：权限判的是 A，
    # PG 行写进 B 的集合，向量却写进 A 的 Milvus 库 —— 一次上传同时污染两处。
    # 实测就是这么发生的：往新建的 ragbench_fast 里传第二份同名集合文档时，
    # 409 报的是「已存在于 ragbench_formats」，而那其实是另一个库里的同名集合。
    owner = await collection_service.collection_database_name_service(name=collection_name)
    if owner and owner != database_name:
        raise HTTPException(
            status_code=409,
            detail=(
                f"集合「{collection_name}」属于知识库「{owner}」，不在「{database_name}」里。"
                "集合名目前是全局唯一的（不是每库一套命名空间），"
                "请改用别的集合名，或把请求的库改成它真正所属的那个。"
            ),
        )

    doc_dir = Path(doc_addr)
    doc_dir.mkdir(parents=True, exist_ok=True)
    document_id = uuid4()
    # 文件名由服务端生成（uuid + 白名单扩展名），原始名只作为标题保存
    tmp_path = doc_dir / f"{document_id}-{safe_filename}"
    relative_path = tmp_path.name
    document_created = False

    try:
        # ── 2. 流式落盘 + 边写边算哈希 ──
        # 原来是一次 `await file.read()`：上限之外的文件会整份进内存，
        # 而且没有任何上限，一次上传就能写满这块盘。
        hasher = sha256()
        written = 0
        with open(tmp_path, "wb") as sink:
            while chunk := await file.read(_CHUNK):
                written += len(chunk)
                if written > max_upload_bytes:
                    raise _TooLarge()
                hasher.update(chunk)
                sink.write(chunk)
        digest = hasher.hexdigest()

        # ── 3. 写完立刻回读校验 ──
        # 这一步是唯一能阻止「PG 有记录、盘上没文件」的机制。本机 6 篇文档就是
        # 在没有这道校验的年代进来的，结果是整个知识库再也重索引不了。
        readback = tmp_path.read_bytes()
        if len(readback) != written or sha256(readback).hexdigest() != digest:
            raise RuntimeError("写入校验失败：盘上内容与收到的字节不一致")

        # ── 4. 去重（集合内内容哈希唯一）──
        duplicate = await pg_service.document_find_by_digest(
            collection_id=collection.id, sha256=digest
        )
        if duplicate:
            tmp_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=409,
                detail=f"该文件已存在于集合 {collection_name}（{duplicate}）",
            )

        # ── 5. 分块 + 向量化 ──
        # 这两步都是**阻塞**的：解析要读文件并跑 unstructured，嵌入是「每块一次 HTTP」。
        # 放在协程里直接调用的后果本轮实测到了：往基准库里连传文档时，
        # 整个进程不答话 —— 连 `/health` 都不回（它又不碰 Milvus）。
        # 一篇 2.4 万字 ≈ 47 块 ≈ 7 秒，一百篇就是「用户上传文档期间系统像挂了」。
        # 与 §6.2.2 修流式时同一条判据：等外部 I/O 的同步代码不进线程，占的就是所有人的循环。
        chunks, embeddings = await anyio.to_thread.run_sync(
            _parse_and_embed, str(tmp_path), embedding_model
        )

        # ── 6. 写 PG：Document ──
        await pg_service.document_create_service(
            id=document_id,
            title=safe_filename,
            uploader=current_user.name,
            collection_id=collection.id,
            meta={
                "source": chunks[0].metadata.get("source", ""),
                # 存相对路径：绝对路径在换机器、换目录、容器重建时都会整体失效。
                "stored_path": relative_path,
                "sha256": digest,
                "size_bytes": written,
                "index_status": "pending",
                "embedding_model": xinference_embedding_model_id,
            },
        )
        document_created = True

        # ── 7. 写 PG：Chunks ──
        created_at = int(time())
        data = []

        for text, embedding in zip(chunks, embeddings):
            chunk = await pg_service.chunk_create_service(
                doc_id=document_id,
                content=text.page_content,
            )
            item = {
                "embedding": [float(x) for x in embedding],
                "doc_id": str(document_id),
                "chunk_id": chunk.id,
            }
            data.append(item)

        # ── 8. 写 Milvus ──
        milvus.use_database(db_name=database_name)

        available_fields = _collection_fields(milvus, collection_name)
        for item in data:
            if "source_type" in available_fields:
                item["source_type"] = "document"
            if "embedding_model" in available_fields:
                item["embedding_model"] = xinference_embedding_model_id
            if "created_at" in available_fields:
                item["created_at"] = created_at

        milvus.insert(collection_name=collection_name, data=data)

        # ── 9. 更新 PG 状态 ──
        await pg_service.document_update_meta_service(
            document_id=document_id,
            meta={"index_status": "indexed", "chunk_count": len(chunks)},
        )

        return {
            "document_id": str(document_id),
            "filename": safe_filename,
            "chunk_count": len(chunks),
            "size_bytes": written,
            "source_available": True,
            "status": "indexed",
        }

    except HTTPException:
        # 上面自己决定的 404/409/415 必须原样出去。
        # 原来它们会掉进下面的 `except Exception` 被重新包成 500，
        # 于是「重复上传」这种正常拒绝在界面上长得像服务器坏了。
        # 需要清理临时文件的分支（409）已经自己在 raise 之前 unlink 过了。
        raise
    except _TooLarge:
        if not document_created:
            tmp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=413,
            detail=f"文件超过上限 {max_upload_bytes // (1024 * 1024)} MB",
        )
    except ParserUnavailable as e:
        config_logger.error("document parser unavailable for %s: %s", safe_filename, e)
        if not document_created:
            tmp_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=501,
            detail=(
                f"{e.ext} 已被支持，但这套部署缺少解析它所需的依赖：{e.hint}。"
                "未写入任何数据。"
            ),
        )
    except Exception as e:  # noqa: BLE001
        # 细节只进日志：str(e) 里可能有连接串、绝对路径、依赖版本。
        # 原来它同时被写进 meta.index_error（会被 /all 与 /get 发给任何可读的人）
        # 和 HTTP detail 两处，等于把内部信息广播出去。
        config_logger.error(
            "document upload failed for %s (%s): %s",
            safe_filename,
            type(e).__name__,
            e,
            exc_info=True,
        )
        if not document_created:
            # 没有任何记录引用这个文件，留着它就成了盘上的孤儿
            tmp_path.unlink(missing_ok=True)
        if document_created:
            await pg_service.document_update_meta_service(
                document_id=document_id,
                meta={"index_status": "failed", "index_error_type": type(e).__name__},
            )
        # 模型/向量库不可用是上游故障（502），解析与写库失败才是我们自己的（500）。
        # 原来两者都报 500，运维时会把「没装模型」当成代码 bug 查。
        upstream = isinstance(e, (RuntimeError, ConnectionError, OSError))
        raise HTTPException(
            status_code=502 if upstream else 500,
            detail=f"文档索引失败：{type(e).__name__}，详情见服务端日志 ametrine.log",
        )

    except BaseException:
        # 上面那批 except 全抓不到**取消**：客户端断开时 Starlette 取消这条协程，
        # 抛的是 asyncio.CancelledError（Python 3.8 起它是 BaseException 的子类）。
        # 于是解析+向量化跑到一半被取消时，文件已经落盘、PG 里却没有行 ——
        # 这个文件在界面上永远删不掉（删除是按 document_id 走的），盘上只会越积越多。
        # 实测：两次「整本 epub 上传到超时被断开」留下 727KB + 561KB 两个孤儿文件。
        if not document_created:
            tmp_path.unlink(missing_ok=True)
        raise

@route_document.post(
    "/{document_id}/reindex",
    summary="重建单篇文档的分块与向量（需重新上传才能救回的除外）",
    responses=_INGEST_FAILURE_RESPONSES,
)
async def reindex_document(
    document_id: UUID,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
    milvus: MilvusClient = Depends(get_milvus_service),
    # 入库只需要 embedding 句柄，不需要整个 LLMService —— 后者会把 get_tokenizer 一起拖进来：
    # 分词器不可用时（本机实测：HF 不可达，重试 5 次约 23 秒后抛错）依赖解析阶段就直接 500，
    # 于是白名单 415、超限 413、重复 409、缺解析器 501 一条都到不了，
    # 而每个请求都要重新付一次下载重试。切分与向量化本就与聊天分词器无关（同 707 行的召回测试）。
    embedding_model=Depends(get_embedding_model),
):
    """把一篇已入库的文档按**当前**的切分与 embedding 配置重做一遍。

    为什么这是这一整个方向里最要紧的一个端点：换 chunk 参数、改中文断句、
    换 embedding 模型，过去都没有出路 —— 旧数据只能停在原地，
    而「换模型」还会让新旧向量不可比（§5.2(c)）。没有它，其它一切改进都落不到已有知识上。

    顺序刻意是**先加后 retirement**：新分块与新向量先写完，确认成功之后才删旧的。
    反过来会在「Milvus 删完、新向量没写进去」之间留下一个**召回为零**的窗口，
    而那正是重建最不该造成的后果 —— 让库比重建前更空。
    """
    located = await pg_service.document_locate_service(document_id=document_id)
    await perm_service.require_write_database(
        current_user.id, located["database_name"]
    )

    stored = _resolve_stored_path(located["stored_path"])
    document_row = await pg_service.document_get_service(document_id=document_id)
    old_digest = ((document_row.meta if document_row else None) or {}).get("sha256")
    # 无论当初存的是绝对路径还是文件名，重写时一律归一成相对 DOC_ADDR 的路径
    try:
        relative_stored = str(stored.relative_to(Path(doc_addr))) if stored else None
    except ValueError:
        relative_stored = stored.name if stored else None
    if stored is None:
        # 这是本机现在对全部 6 篇文档的真实回答：原文不在盘上，谁都没法重做它。
        # 绝不能静默跳过或回 200 —— 那样用户会以为重建成功了，而库里的分块一个字节都没变。
        raise HTTPException(
            status_code=409,
            detail=(
                f"《{located['title']}》的原文已不在磁盘上（记录里的路径是 "
                f"{located['stored_path'] or '(空)'}）。"
                "分块与向量是它唯一的副本，因此无法重新切分或换模型重索引 —— "
                "要恢复可重建性，请重新上传原件。"
            ),
        )

    # 解析与向量化放在任何写入之前：模型没加载时这里就抛，
    # 于是「失败但把库改坏」这条路径从结构上不存在。
    contents = stored.read_bytes()
    digest = sha256(contents).hexdigest()
    try:
        chunks, embeddings = await anyio.to_thread.run_sync(
            _parse_and_embed, str(stored), embedding_model
        )
    except HTTPException:
        raise
    except ParserUnavailable as e:
        # 依赖缺口要如实说出来并给 501：这不是上游服务挂了（502），
        # 也不是代码 bug（500），而是这套部署没装解析器 —— 修法完全不同。
        config_logger.error("reindex parser unavailable for %s: %s", document_id, e)
        raise HTTPException(
            status_code=501,
            detail=(
                f"重建没能开始：{e.hint}。"
                "库里的分块与向量都还是原来那一套，未做任何改动。"
            ),
        )
    except Exception as exc:  # noqa: BLE001
        config_logger.error(
            "reindex failed while preparing %s (%s): %s",
            document_id,
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"重建没能开始：{type(exc).__name__}。"
                "库里的分块与向量都还是原来那一套，未做任何改动；修好模型/解析器后直接重试。"
            ),
        )

    if len(chunks) != len(embeddings):
        raise HTTPException(
            status_code=500,
            detail="分块数量与向量数量不一致，已中止重建（未写入任何东西）",
        )

    old_chunks = await pg_service.chunk_get_by_document_service(doc_id=document_id)
    old_ids = [chunk.id for chunk in old_chunks]

    milvus.use_database(db_name=located["database_name"])
    available_fields = _collection_fields(milvus, located["collection_name"])
    created_at = int(time())

    # ── 先写新的 ──
    new_rows = []
    try:
        for chunk, embedding in zip(chunks, embeddings):
            row = await pg_service.chunk_create_service(
                doc_id=document_id, content=chunk.page_content
            )
            item = {
                "embedding": [float(x) for x in embedding],
                "doc_id": str(document_id),
                "chunk_id": row.id,
            }
            if "source_type" in available_fields:
                item["source_type"] = "document"
            if "embedding_model" in available_fields:
                item["embedding_model"] = xinference_embedding_model_id
            if "created_at" in available_fields:
                item["created_at"] = created_at
            new_rows.append((row, item))

        milvus.insert(
            collection_name=located["collection_name"],
            data=[item for _row, item in new_rows],
        )
        milvus.flush(collection_name=located["collection_name"])
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        config_logger.error(
            "reindex write failed for %s (%s): %s",
            document_id,
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"新向量写入失败：{type(exc).__name__}。旧分块与旧向量**保持原样**未动，"
                "检索结果不受影响；修好依赖后重试本接口即可收敛。"
            ),
        )

    # ── 再退休旧的（此刻新向量已经可检索；就算这一步失败也只是多几份重复，不会少内容）──
    retired, vector_retired = 0, 0
    if old_ids:
        try:
            _ensure_loaded(milvus, located["collection_name"])
            milvus.delete(
                collection_name=located["collection_name"],
                filter='doc_id == "%s" and chunk_id in %s'
                % (document_id, old_ids),
            )
            milvus.flush(collection_name=located["collection_name"])
            vector_retired = len(old_ids)
        except Exception as exc:  # noqa: BLE001
            # 明确报出来：留着旧向量意味着同一篇内容会占掉好几个检索名额，
            # 但它比「悄悄说成功」好得多，重试即可清掉。
            config_logger.error(
                "reindex could not retire old vectors for %s: %s",
                document_id,
                exc,
                exc_info=True,
            )
        else:
            for chunk_id in old_ids:
                await pg_service.chunk_delete_row_service(
                    doc_id=document_id, chunk_id=chunk_id
                )
            retired = len(old_ids)

    await pg_service.document_update_meta_service(
        document_id=document_id,
        meta={
            "index_status": "indexed",
            "chunk_count": len(new_rows),
            "sha256": digest,
            "size_bytes": len(contents),
            "stored_path": relative_stored,
            "embedding_model": xinference_embedding_model_id,
            "reindexed_at": created_at,
        },
    )

    return {
        "document_id": str(document_id),
        "chunk_count": len(new_rows),
        "retired_chunks": retired,
        "retired_vectors": vector_retired,
        "embedding_model": xinference_embedding_model_id,
        # 原文换了内容就明说：这让调用方能区分「只是换了切分参数」与「顺手把新版本收进来了」
        "content_changed": old_digest is not None and old_digest != digest,
    }


@route_document.delete("/{document_id}", summary="删除文档（PG + Milvus 同步级联）")
async def delete_document(
    document_id: UUID,
    # 知识库原来只能往里加：没有任何删除入口，传错了、传重了、
    # 或者文档里有不该被检索到的内容都清不掉。这是同类产品的基线能力。
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
    milvus: MilvusClient = Depends(get_milvus_service),
):
    doc = await pg_service.document_locate_service(document_id=document_id)
    await perm_service.require_write_database(current_user.id, doc["database_name"])

    # 先删向量、后删关系行：反过来一旦 Milvus 失败，PG 已经没了，
    # 那批向量就变成谁也查不到的孤儿。这个顺序下 Milvus 失败时 PG 保持完整，可重试。
    milvus.use_database(db_name=doc["database_name"])
    try:
        _ensure_loaded(milvus, doc["collection_name"])
        milvus.delete(
            collection_name=doc["collection_name"],
            filter='doc_id == "%s"' % doc["document_id"],
        )
        milvus.flush(collection_name=doc["collection_name"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail="向量删除失败（%s）：%s" % (
                type(exc).__name__,
                _vector_delete_advice(exc, "文档未删除"),
            ),
        )

    # stored_path 现在可能是相对 DOC_ADDR 的，服务层拿到手必须已经是可 open 的路径；
    # 解析不到就传 None，让 removed_file 如实回 false —— 这个字段以前一直是 false，
    # 而从来没有人看过它，于是「原文其实早就没了」这件事一直没人知道（见交接文档 §5.0）。
    resolved = _resolve_stored_path(doc.get("stored_path"))
    outcome = await pg_service.document_delete_service(
        document_id=document_id, stored_path=str(resolved) if resolved else None
    )
    return {
        **outcome,
        # 让调用方能区分「删掉了原文」与「只有记录、原文早就不在」。
        "source_was_present": resolved is not None,
    }


# ═══════════════════════════════════════════
# 分块级管理（停用 / 改正文 / 删单块）
# ═══════════════════════════════════════════

_CHUNK_FILTER = 'doc_id == "%s" and chunk_id == %d'


async def _require_chunk_write(doc_id: UUID, chunk_id: int, current_user, perm_service, pg_service):
    """所有分块写路由的第一件事：确认这一块确实属于那篇文档，并且用户能写它所在的库。

    分块主键是全局自增 id，只看 chunk_id 就能拿 A 文档的接口改到 B 文档的分块，
    跨集合、跨租户都命中得了。
    """
    owner = await pg_service.chunk_ownership_service(doc_id=doc_id, chunk_id=chunk_id)
    await perm_service.require_write_database(current_user.id, owner["database_name"])
    return owner


def _vector_item(embedding, doc_id: UUID, chunk_id: int, available_fields: set[str]) -> dict:
    item = {
        "embedding": [float(x) for x in embedding],
        "doc_id": str(doc_id),
        "chunk_id": chunk_id,
    }
    # 这几个字段是可选的：老集合没有它们，硬塞会报 schema 不匹配。
    if "source_type" in available_fields:
        item["source_type"] = "document"
    if "embedding_model" in available_fields:
        item["embedding_model"] = xinference_embedding_model_id
    if "created_at" in available_fields:
        item["created_at"] = int(time())
    return item


@route_document.patch("/chunk/{doc_id}/{chunk_id}/enabled", summary="停用/启用单个分块")
async def set_chunk_enabled(
    doc_id: UUID,
    chunk_id: int,
    enabled: bool = Body(..., embed=True),
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
):
    """停用 = 不参与检索，但正文与向量都留着，随时可以再打开。

    专业 RAG 产品都有这一层：召回到一段过期或有问题的文字时，
    正确的动作是先把它从检索里摘出来，而不是删掉整篇文档、或者重新上传一版。
    排除在读取正文处生效（见 chunk_get_many_service），所以向量侧不用改。
    """
    await _require_chunk_write(doc_id, chunk_id, current_user, perm_service, pg_service)
    return await pg_service.chunk_set_enabled_service(
        doc_id=doc_id, chunk_id=chunk_id, enabled=enabled
    )


@route_document.patch("/{document_id}/enabled", summary="停用/启用整篇文档的分块")
async def set_document_enabled(
    document_id: UUID,
    enabled: bool = Body(..., embed=True),
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
):
    doc = await pg_service.document_locate_service(document_id=document_id)
    await perm_service.require_write_database(current_user.id, doc["database_name"])
    return await pg_service.document_set_enabled_service(
        doc_id=document_id, enabled=enabled
    )


@route_document.put("/chunk/{doc_id}/{chunk_id}", summary="修改分块正文并重新向量化")
async def update_chunk(
    doc_id: UUID,
    chunk_id: int,
    content: str = Body(..., embed=True),
    # 依赖顺序：鉴权与权限排在会打 Milvus / Xinference 的依赖之前。
    # get_embedding_model 只是构造句柄，联网是在正文里 embed 的那一刻，
    # 所以模型没起来时这里仍然返回 403/404，而不是把权限判断顶成 500。
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
    milvus: MilvusClient = Depends(get_milvus_service),
    embeddings=Depends(get_embedding_model),
):
    """分块是可以改的：切分不理想时，改这一块的正文比重传整份文档代价小得多。

    关键约束是「向量必须跟着正文走」。只更新 PG 的话，检索仍然按旧向量召回，
    而引用与上下文取的是新正文 —— 分数与内容从此对不上，而且没有任何地方会报错。
    所以顺序是：先算新向量，再换掉 Milvus 里的那条，最后才落 PG。
    """
    owner = await _require_chunk_write(doc_id, chunk_id, current_user, perm_service, pg_service)
    new_text = content.strip()
    if not new_text:
        raise HTTPException(status_code=422, detail="分块正文不能为空")
    if new_text == (owner["content"] or "").strip():
        return {"chunk_id": chunk_id, "changed": False, "enabled": owner["enabled"]}

    try:
        embedding = (await anyio.to_thread.run_sync(
            embeddings.embed_documents, [new_text]))[0]
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail="向量化失败，分块未修改（模型侧：%s）" % type(exc).__name__,
        )

    collection_name = owner["collection_name"]
    milvus.use_database(db_name=owner["database_name"])
    try:
        _ensure_loaded(milvus, collection_name)
        milvus.delete(
            collection_name=collection_name,
            filter=_CHUNK_FILTER % (doc_id, chunk_id),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail="旧向量删除失败（%s）：%s" % (
                type(exc).__name__,
                _vector_delete_advice(exc, "分块正文未修改"),
            ),
        )
    try:
        milvus.insert(
            collection_name=collection_name,
            data=[
                _vector_item(
                    embedding, doc_id, chunk_id, _collection_fields(milvus, collection_name)
                )
            ],
        )
        milvus.flush(collection_name=collection_name)
    except Exception as exc:  # noqa: BLE001
        # 说清楚后果：这一条此刻检索不到，但重试本次修改就能恢复。
        raise HTTPException(
            status_code=502,
            detail="新向量写入失败：旧向量已删，该分块暂时检索不到。正文未修改，重试本次修改即可恢复（%s）"
            % type(exc).__name__,
        )

    await pg_service.chunk_touch_service(
        doc_id=doc_id, chunk_id=chunk_id, content=new_text
    )
    return {"chunk_id": chunk_id, "changed": True, "enabled": owner["enabled"]}


@route_document.delete("/chunk/{doc_id}/{chunk_id}", summary="删除单个分块（PG + Milvus）")
async def delete_chunk(
    doc_id: UUID,
    chunk_id: int,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
    milvus: MilvusClient = Depends(get_milvus_service),
):
    """删一块而不必删整篇文档。

    顺序沿用文档删除那条：先向量后 PG。反过来一旦 Milvus 失败，PG 行已经没了，
    那条向量就成了谁也查不到、也删不掉的孤儿。
    """
    owner = await _require_chunk_write(doc_id, chunk_id, current_user, perm_service, pg_service)
    collection_name = owner["collection_name"]
    milvus.use_database(db_name=owner["database_name"])
    try:
        _ensure_loaded(milvus, collection_name)
        milvus.delete(
            collection_name=collection_name,
            filter=_CHUNK_FILTER % (doc_id, chunk_id),
        )
        milvus.flush(collection_name=collection_name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail="向量删除失败（%s）：%s" % (
                type(exc).__name__,
                _vector_delete_advice(exc, "分块未删除"),
            ),
        )
    await pg_service.chunk_delete_row_service(doc_id=doc_id, chunk_id=chunk_id)
    return {"message": "分块 %d 已删除" % chunk_id, "chunk_id": chunk_id}


@route_document.post("/recall", summary="检索预览（只跑检索与重排，不调用大模型）")
async def recall_test(
    collection_name: str = Body(..., embed=True),
    database_name: str = Body(..., embed=True),
    query: str = Body(..., embed=True),
    top_k: int = Body(10, embed=True),
    rerank: bool = Body(True, embed=True),
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    document_service: DocumentService = Depends(get_document_service),
    vector_document_service: VectorDocumentService = Depends(
        get_vector_document_service
    ),
    llm_service: LLMService = Depends(get_llm_service),
):
    """命中测试：给一句话，看知识库到底召回了什么、分数多少。

    这是 RAGFlow / Dify 这类产品里排障价值最高的一个子功能 ——
    「回答不对」分成三种：没召回到、召回到但排序靠后、召回到也排第一但模型没用好。
    没有这个面板就只能靠改 .env 重启再猜。
    刻意不调用大模型：既快又省，也不会把预览算进用量配额。
    """
    await perm_service.require_read_database(current_user.id, database_name)
    hits = await vector_document_service.document_query_service(
        database_name=database_name, collection_name=collection_name, data=query, limit=top_k
    )

    if rerank:
        ranked = await llm_service.rerank(
            question=query, context=hits, collection_name=collection_name
        )
        mode = "rerank"
    else:
        ranked = await llm_service.hydrate_texts(llm_service.vector_rank(hits))
        mode = "vector"

    references = await llm_service.parse_references(ranked)
    titles = {r.get("id"): r.get("title") for r in references}
    return {
        "mode": mode,
        "candidate_count": len(hits),
        "returned": len(ranked),
        "results": [
            {
                "doc_id": item.get("doc_id"),
                "document_title": titles.get(item.get("doc_id")),
                "chunk_id": item.get("chunk_id"),
                "relevance_score": item.get("relevance_score"),
                "text": item.get("text"),
            }
            for item in ranked
        ],
    }
