import anyio
from fastapi import Depends, HTTPException
from pymilvus import MilvusClient
from pymilvus.exceptions import MilvusException
from src.client import get_milvus_service
from src.llm.service import LLMService, get_llm_service
from src.relation.service import RelationService, get_relation_service

from .fusion import rrf_merge

# 「切库 + 检索」的互斥锁。`MilvusClient.use_database()` 改的是共享实例自己的状态，
# 阻塞搬到线程之后就没有「协程不让出」那道免费的串行保护了 —— 见 DocumentService._search_block。
# 一次只放一个请求过去：这是**正确性**要求，不是节流。
# 需要重新引入 per-request 客户端（或每请求建一个 MilvusClient）才能把它解开。
_milvus_lock = anyio.Lock()


class DocumentService:
    def __init__(
        self,
        milvus_service: MilvusClient,
        relation_service: RelationService,
        llm_service: LLMService,
    ):
        self.milvus_service = milvus_service
        self.relation_service = relation_service
        self.llm_service = llm_service

    def _probe_collection(self, collection_name: str) -> bool:
        """这个集合在向量库里到底有没有。

        `has_collection()` 对**非法名字是抛异常**而不是返回 False（本机实测：
        历史遗留的 `faman-collection` 得到 `code=1100 Invalid collection name`）。
        那种情况过去直接穿透到 500，界面上就是一句「服务器错误」，
        而真相是「这条记录在向量库里永远不可能存在」——两句的区别用户是能动手与不能动手。
        """
        try:
            return bool(self.milvus_service.has_collection(collection_name=collection_name))
        except MilvusException as exc:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"集合「{collection_name}」在向量库里不存在或名字不被接受"
                    f"（{type(exc).__name__}）。这多半是当年 PG 写完、向量侧同步失败留下的"
                    "半条记录：删掉这个集合重建才能恢复检索，问它是问不出结果的。"
                ),
            ) from exc

    def _search_with_vector(
        self, collection_name: str, vector: list[float], limit: int
    ) -> list[dict]:
        """对一个集合发一次向量检索。命中的每条是 {id, distance, entity{doc_id, chunk_id}}：
        distance 一直在结果里（它不是 output_field，是检索器附带的），
        所以「不重排、直接按向量距离取前 p 条」这条路是可行的 ——
        之前以为要先把 distance 加进 output_fields 才能做，是判断错了。

        **刻意不在 finally 里 release_collection。** 原来每次检索都 load→search→release，
        交接文档 §2.1 把它记成「小数据无感」，本机量下来根本不是无感：
        三块文本的集合上一次完整检索 2059 ms，而装载好之后同一件事 8 ms、纯 search 2 ms
        —— 那两秒几乎全是 release 加上下一次 load 付掉的（每问一次都重付）。
        留在装载状态的成本是查询节点的内存，而这个规模下那是最不值钱的一样东西；
        真要收回内存有 `/vector/collection/*` 的删除路径和重启，不靠每次提问去还。
        `load_collection` 保留：它对已装载的集合是幂等且几乎免费的（实测 8 ms），
        而 Milvus 重启之后就是靠这一次把状态自愈回来。
        """
        if not self._probe_collection(collection_name):
            raise HTTPException(status_code=404, detail="Collection not found")
        self.milvus_service.load_collection(collection_name=collection_name)
        res = self.milvus_service.search(
            collection_name=collection_name,
            data=[vector],
            output_fields=["doc_id", "chunk_id"],
            timeout=30,
            limit=limit,
        )
        return list(res[0])

    def _search_block(
        self, sources: list[tuple[str, str]], vector: list[float], limit: int
    ) -> list[list[dict]]:
        """一整段「切库 + 检索」，同步、跑在一个线程里。

        整段放在同一个临界区是有原因的：`use_database()` 改的是**共享客户端自身**的状态，
        以前靠「协程里全是同步调用、根本不让出」侥幸串行；把阻塞搬到线程之后那份侥幸就没了
        —— 两个请求会互相把对方的库换掉，得到**静默错库**的结果（比慢严重得多）。
        所以这里一次锁住整段，而不是每次 use_database 单独锁。
        """
        runs: list[list[dict]] = []
        for database_name, collection_name in sources:
            self.milvus_service.use_database(database_name)
            hits = self._search_with_vector(collection_name, vector, limit)
            for hit in hits:
                hit["database_name"] = database_name
                hit["collection_name"] = collection_name
            runs.append(hits)
        return runs

    async def _embedded(self, text: str) -> list[float]:
        """嵌入放到线程里：`_embed_one` 是一到两次对外部 HTTP 的阻塞调用，
        而 Xinference 卡住时 `requests` 没有超时 ⇒ 一条请求冻住整个 worker，连 /health 都不答。
        """
        return await anyio.to_thread.run_sync(
            self.llm_service.embedding_model.embed_query, text
        )

    async def _search(self, sources: list[tuple[str, str]], vector: list[float], limit: int):
        async with _milvus_lock:
            return await anyio.to_thread.run_sync(self._search_block, sources, vector, limit)

    async def document_query_service(
        self, database_name: str, collection_name: str, data: str, limit: int = 10
    ):
        # 这里原来挂着 `@use_vector_database()`：它在事件循环上同步调 `use_database()`，
        # 而 `_search_block` 已经在线程里、锁内切过一次库。留两份等于「同一个动作两个地方做」，
        # 并且多出来那次仍然是阻塞的 —— 拆掉之后切库点只剩一处。
        vector = await self._embedded(data)
        return (await self._search([(database_name, collection_name)], vector, limit))[0]

    async def documents_query_multi_service(
        self, data: str, sources: list[tuple[str, str]], limit: int = 10
    ):
        """多库 / 多集合检索：一次提问打到若干 (database, collection)。

        三条不那么显然的实现约束，都是这台机器上量出来的：

        1. **只嵌入一次**。每个源各调一次 embed_query 不只是浪费，
           还会让各路召回用的其实不是同一个向量（模型有噪声时顺序都可能不可比）。
        2. **必须顺序、且必须整段互斥**。见 `_search_block` 的注释：共享客户端的
           `use_database()` 是全局状态。同一层教训在本仓踩过两次：五条查询共用一个
           AsyncSession 直接 IllegalStateChangeError；流式在协程里迭代同步生成器冻住事件循环。
        3. 各路结果不能按原始距离混排（L2 距离跨库不可比），所以走 `rrf_merge`。
        """
        if not sources:
            raise HTTPException(status_code=422, detail="至少要指定一个检索来源")
        vector = await self._embedded(data)
        return rrf_merge(await self._search(sources, vector, limit))

    def _collection_fields(self, collection_name: str) -> set[str]:
        collection = self.milvus_service.describe_collection(
            collection_name=collection_name
        )
        return {field["name"] for field in collection.get("fields", [])}


def get_document_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
    relation_service: RelationService = Depends(get_relation_service),
    llm_service: LLMService = Depends(get_llm_service),
) -> DocumentService:
    return DocumentService(
        milvus_service=milvus_service,
        relation_service=relation_service,
        llm_service=llm_service,
    )
