from asyncio import Semaphore
from json import dumps, loads
from operator import attrgetter
from time import monotonic
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from src.client import TaskType, get_redis
from src.config import max_model_len
from src.llm.dto.chat import RAGChat
from src.llm.streaming import StreamGuard
from src.llm.telemetry import (
    build_retrieval_telemetry,
    dump_telemetry,
    telemetry_key,
)
from src.middleware.logger import config_logger, log
from src.middleware.tags import ControllerTag
from src.vector.documents.service import DocumentService, get_document_service
from src.user.permissions import PermissionService, get_permission_service
from src.user.auth.service import get_current_user
from src.user.quota import enforce_quota

from .dto.chat import LLMChat
from .prompt import compose_system_prompt, system_prompt_llm, system_prompt_rag
from .service import LLMService, get_llm_service

route_llm = APIRouter(prefix="/llm", tags=[ControllerTag.llm])


def ref_key(user_id: int, session_id: str) -> str:
    return f"chat_ref:{user_id}:{session_id}"


@route_llm.post("/chat", summary="[LLM] 基础对话")
@log("Chat")
async def chat(
    dto: LLMChat,
    # 前端真正用的是 /api/llm/chat（/api/chat 那个统一入口暂时没人调），
    # 而它原本是这四个端点里唯一没有鉴权的：任何人不带凭证就能占信号量、烧推理算力。
    # /api/llm/rag 早就有 current_user，这里补齐同一标准。
    # 依赖必须排在 service 之前：service 会去打 Xinference，本机没模型时先炸 500，
    # 「没登录」的请求就看不到 401（实测踩过）。enforce_quota 自带 current_user 依赖，
    # 所以把它放在最前同时满足了这两条。
    _quota=Depends(enforce_quota),
    service: LLMService = Depends(get_llm_service),
    current_user=Depends(get_current_user),
    redis_client=Depends(get_redis),
):
    prompt, chat_history = attrgetter("prompt", "chat_history")(dto)

    messages = [
        {
            "role": "system",
            "content": compose_system_prompt(
                system_prompt_llm, current_user.system_prompt
            ),
        }
    ]
    messages.extend(chat_history)
    messages.append({"role": "user", "content": prompt})
    # 名额必须活到流结束（见 src/llm/streaming.py 顶部那段）：原来这里是
    # `async with get_semaphore(...)` 包住「创建流对象」，所以 SEMAPHORE 限的是开流瞬间。
    guard = await StreamGuard.open(TaskType.LLM, redis_client, current_user.id)
    try:
        res = service.llm_model.chat(
            messages=messages,
            generate_config={"stream": True, "max_tokens": max_model_len},
        )
    except Exception:
        guard.close()
        raise
    return StreamingResponse(
        content=guard.stream(service.stream_by_token(res)),
        media_type="text/event-stream",
        status_code=200,
    )


@route_llm.post("/rag", summary="[RAG] 检索对话")
@log("RAG")
async def search(
    dto: RAGChat,
    # current_user 必须排在 document_service / service 之前：后面的依赖会真去打
    # Milvus 与 Xinference，本机没就绪时先炸 500，未登录的请求就永远看不到 401。
    # enforce_quota 排最前：配额到点的请求不该再去占一次检索与重排的算力。
    _quota=Depends(enforce_quota),
    current_user=Depends(get_current_user),
    document_service: DocumentService = Depends(get_document_service),
    service: LLMService = Depends(get_llm_service),
    redis_client=Depends(get_redis),
    perm_service: PermissionService = Depends(get_permission_service),
):
    raw_prompt, chat_history, database_name, collection_name = attrgetter(
        "prompt", "chat_history", "database_name", "collection_name"
    )(dto)
    sources = [(s.database_name, s.collection_name) for s in (dto.sources or [])]
    if not sources:
        sources = [(database_name, collection_name)]
    # 检索中间态的耗时从「开始检索」算起，不含鉴权与配额（那是另一段成本，也不属于「为什么没答对」）。
    retrieval_started = monotonic()
    # 权限逐库判定，任一被拒就整条请求 403：静默少召回一个库，
    # 用户看到的答案看起来完全正常，但依据少了一半。
    for source_db, _source_col in sources:
        await perm_service.require_read_database(current_user.id, source_db)

    if len(sources) == 1:
        single_db, single_col = sources[0]
        context = await document_service.document_query_service(
            database_name=single_db,
            collection_name=single_col,
            data=raw_prompt,
            limit=dto.top_k,
        )
        candidates = len(context)
        if dto.rerank:
            output = await service.rerank(
                question=raw_prompt, context=context, collection_name=single_col
            )
        else:
            # 关掉重排时走向量距离直排：省掉一整轮重排模型往返，
            # 代价是不再套用 min_relevance_score（那是给 0..1 相关性分定的阈值）。
            output = await service.hydrate_texts(service.vector_rank(context))
    else:
        # 跨库前置判断：L2 距离只在同一 embedding 模型产生的向量之间有意义。
        relation_documents = service.relation_service.documentService
        models = await relation_documents.embedding_models_for_databases(
            sorted({db for db, _ in sources})
        )
        distinct = sorted({model for lst in models.values() for model in lst})
        if len(distinct) > 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    "这些知识库用了不同的 embedding 模型（"
                    + " vs ".join(distinct)
                    + "），跨库混排检索出来的次序没有意义。"
                    "请单选一个库提问，或把相关库重建到同一个模型上。"
                ),
            )
        fused = await document_service.documents_query_multi_service(
            data=raw_prompt, sources=sources, limit=dto.top_k
        )
        candidates = len(fused)
        if dto.rerank:
            # 先补正文（一条都不丢），再让重排模型给一次 0..1 的相关性分；
            # 截断仍然统一发生在 unify_filter 里，与单库路径同一份语义。
            hydrated = await service.hydrate_texts(fused, limit=len(fused))
            output = await service.rerank_items(raw_prompt, hydrated)
        else:
            # 关重排时 RRF 名次就是最终次序。融合分数是 Σ1/(k+rank) 量纲，
            # 绝不能拿 min_relevance_score（0..1 相关性阈值）去筛它。
            output = await service.hydrate_texts(fused)
        locations = await relation_documents.document_locations(
            [item.get("doc_id") for item in output if item.get("doc_id")]
        )
        for item in output:
            found = locations.get(str(item.get("doc_id")))
            if found:
                item["database_name"] = found["database_name"]
                item["collection_name"] = found["collection_name"]
    prompt = service.create_user_prompt(question=raw_prompt, context=output)
    references = await service.parse_references(output)
    session_id = str(uuid4())
    # 键里带 user_id：引用内容含知识库文档标题与来源，只有发起检索的人能取回。
    redis_client.setex(ref_key(current_user.id, session_id), 600, dumps(references))
    # 检索中间态与引用同生命周期但不同 TTL：引用给界面看，中间态给将来反查用。
    # 写失败只丢证据、不丢答案 —— 诊断数据不该有能力打断用户正在等的那句话。
    try:
        dump_telemetry(
            redis_client,
            telemetry_key(current_user.id, session_id),
            build_retrieval_telemetry(
                sources=sources,
                top_k=dto.top_k,
                candidates=candidates,
                returned=len(output),
                scored=output,
                elapsed_ms=int((monotonic() - retrieval_started) * 1000),
            ),
        )
    except Exception as exc:  # noqa: BLE001
        config_logger.warning("retrieval telemetry unavailable for %s: %s", session_id, exc)

    guard = await StreamGuard.open(TaskType.RAG, redis_client, current_user.id)
    try:
        res = service.llm_model.chat(
            messages=[
                {
                    "role": "system",
                    "content": compose_system_prompt(
                        system_prompt_rag, current_user.system_prompt
                    ),
                },
                *chat_history,
                {"role": "user", "content": prompt},
            ],
            generate_config={
                "stream": True,
                "max_tokens": max_model_len,
            },
        )
    except Exception:
        guard.close()
        raise
    response = StreamingResponse(
        content=guard.stream(service.stream_by_token(res)),
        media_type="text/event-stream",
        status_code=200,
    )
    response.headers["X-Session-ID"] = session_id
    return response


@route_llm.get("/references", summary="[RAG] 取回引用来源")
async def get_references(
    session_id: str,
    current_user=Depends(get_current_user),
    redis_client=Depends(get_redis),
):
    # 引用只在 600 秒 TTL 内可取，过期是这条链路的正常结局，不是异常：
    # 原先 loads(None) 直接把过期/未知 session 炸成 500（实测踩过）。
    # 前端拿到非数组会把「无引用」判定弄错，所以这里始终返回数组。
    ref_json = redis_client.get(ref_key(current_user.id, session_id))
    if not ref_json:
        return []
    return loads(ref_json)
