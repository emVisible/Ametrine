# 2026-09-28 后端契约审计与控制台改版联动方案

上一轮 `2026-09-28-rag-audit-and-ui.md` 关注检索质量与安全。本轮只回答一个问题：
**后端的资源模型与 API 形状，限定了前端哪些呈现方式能做、哪些不能做。** 结论用于指导已上线的知识库控制台改版，并给出后端改造顺序。

标注约定：`我实测` = 本轮直接读文件确认；`代理报告` = 子代理审计给出 file:line 但我未逐条复核，落地前应再确认一次。

## 1. 一个决定性事实：`/api/vector/**` 前端零调用

后端有 16 条 `/api/vector/*` 路由（database 的 all/details/create/get/delete/reset、collection 的 details/all/create/rename/get/delete/reset/reset-all、document 的 search/upload），**没有任何前端调用方**。前端全部走 `/api/relation/*`。

含义有两层：

- 控制台改版不需要考虑 `/vector/*` 的兼容性，可以直接把它当内部接口处理；
- 但它是**公开可访问且无鉴权**的破坏性面（`/vector/database/reset` 会删掉所有 Milvus database 并清空 `tenant` 表）。"没有调用方"不等于"没有攻击面"。

同时存在双份实现：`/relation/document/upload` 与 `/vector/document/upload` 各自完成一次"存文件→分块→embedding→写 PG→写 Milvus→改状态"，且**返回体完全不同**（前者 `{document_id, filename, chunk_count, status}`，后者返回 `get_collection_stats`）。这两者不可互换，必须收敛为一个。

## 2. 资源模型：Milvus collection 到底归属谁

这是控制台能否做「集合下钻」的前提。实测关系链（`apps/backend/src/models.py`）：

```
Tenant ──database_id (FK unique, nullable)──▶ Database ── Collection (database_id FK NOT NULL)
                                                    ◀── Document (collection_id FK NOT NULL)
                                                          ◀── DocumentChunk (doc_id FK NOT NULL)
```

- **`Database` 上没有 `tenant_id` 列**，关系是反挂在 `Tenant.database_id` 上的，且是 1:1（一个租户最多一个知识库）。
- 所以前端列表里看到的 `db.tenant_name` 是后端手写 dict 拼出来的（`relation/databases/service.py:36` 代理报告），不是 ORM 直出。
- `permissions/service.py` 里引用的 `Database.tenant_id` 与 `get_accessible_databases` 在 schema 上站不住，且**没有任何路由调用它**——真正的"我的知识库"是 `/relation/database/mine` 另实现的一份。

**Milvus 归属结论（关键）**：`每个 relation.Collection = 一个独立 Milvus collection`，坐落在 `每个 relation.Database = 一个 Milvus database` 之内，不共享。定位一个向量集合需要 `(Database.name, Collection.name)` 两个字符串，而不是 id：

1. 建库时 Milvus database 名 = PG `Database.name`（`relation/databases/controller.py:28`）；
2. 建集合时先按 `collection.database_id` 取回 `Database.name`，再以 `(database_name, collection_name)` 建 Milvus collection（`relation/collections/controller.py:21,32-35`）；
3. 检索与写入前用 `use_vector_database()` 装饰器按 `database_name` kwarg 切库（`utils/other.py:13-14`）。

**对前端的直接约束**：上传与检索都必须同时携带**知识库名和集合名**，只传 id 无法工作。这解释了为什么 `documentAPI.upload(file, collectionName, databaseName)` 是三个参数而不是一个 id——它不是设计选择，是被后端逼出来的。改版后的控制台因此在三级状态里都保留 `name`，而不是只存 id。

另外：`Collection.name` 在全局唯一（PG unique 约束），但 Milvus 侧按库隔离——所以跨知识库同名集合在 PG 层就会被拒。控制台的创建表单提示了这一点。

## 3. 契约不一致：前端会踩的坑

| 坑 | 证据 | 前端后果 |
|---|---|---|
| `code` 恒为 200 | `middleware/response.py:10` | `apiClient` 读 `result.code` 判成功毫无意义，只能依赖 HTTP status。已按此实现 |
| 详情缺失返回 `null` 而非 404 | `databases/service.py:108`、`collections/service.py:26` | 「不存在」与「值为空」不可区分，前端无法给出准确错误态 |
| 按 name 取详情、按 id 取列表 | `database/get?name=`、`collection/get?collection_name=` vs `document/collection?collection_id=` | 前端必须同时持有两套键，见 §2 |
| 部分端点直出裸 ORM | `collection/all`、`document/all\|collection\|chunk` 无 `response_model` | 字段名 = 裸列名；未 eager-load 的关系（`Document.chunks`、`Tenant.database`）有 lazy-load 崩溃风险（**未确认**运行时是否已抛 `MissingGreenlet`） |
| 登录端点绕过信封 | `auth/controller.py:16` 显式 `response_class=JSONResponse` | 登录必须用裸 fetch 读 `access_token`；若走 `apiClient` 会拿到 `undefined`。现状正确，但很容易踩 |
| 上传绕过 `apiClient` | `api/rag.ts:37` 裸 fetch | 返回值带信封但调用方未解 `data`，只判 `ok` |
| `route_audio` 注册两次 | `main.py:82,85` | 无害但说明路由注册缺乏约束 |

## 4. 控制台所需端点的缺口

| 资源 | 列表 | 分页 | 过滤 q | 排序 | total | 按 id 详情 | 删除 | 状态/进度 | 重建索引 | 分块正文 |
|---|---|---|---|---|---|---|---|---|---|---|
| Database | ✅ `/all` `/mine` | ❌ | ❌ | ❌ | ❌ | ⚠️ 仅按 name | ✅ | ❌ | ❌ | n/a |
| Collection | ✅ `/all/specific` | ❌ |  | ❌ |  | ⚠️ 仅按 name | ✅ | ❌ 无文档计数 | ❌ | n/a |
| Document | ✅ `/collection` | ❌ |  | ❌ |  | ✅ | **❌ 无** | ⚠️ 藏在 meta | **❌ 无** | n/a |
| Chunk | ✅ `/chunk?doc_id=` 返回全部 | ❌ |  | ❌ |  | **❌ 未暴露**（service 支持 `chunk_id` 精确取，controller 没开） | ❌ | ❌ |  | ✅ |

**四族资源全部没有分页、过滤、排序与总数。** 这直接决定了改版后的控制台只能做**客户端**搜索/排序/分页，并且必须避免按行取数。

### 前端因此采用的取数策略

`/relation/collection/all` 与 `/relation/document/all` 能一次取回全量，所以控制台用 **3 个请求建出客户端索引**（`useKnowledgeIndex`）：databases + 全部 collections + 全部 documents，然后在内存里按 `database_id` / `collection_id` 分组，派生出各级计数与下钻数据。

代价与前提：这条路只在个人库规模（几百到几千文档）下成立；一旦文档量上来，`/document/all` 的全量返回会先成为瓶颈。而且 `/relation/document/all` 目前**无鉴权、无过滤**，把它当索引源等于把全库元数据暴露出去——这条既是为性能，也是被迫的；后端补上分页与按集合过滤后应当立刻切回服务端分页。

## 5. 文档生命周期：为什么不该做进度轮询

`index_status` 只存在于 `Document.meta` 这个 JSONB 里（`models.py:115`），没有独立列、没有索引。可达状态：`pending` → `indexed`（带 `chunk_count`）/ `failed`（带 `index_error`，**不带 `chunk_count`**）。

**决定性事实**：两条 ingest 都在**请求内同步**完成分块→embed→写 PG→写 Milvus→改状态（`relation/documents/controller.py:91-151`、`vector/documents/service.py:71-116`），没有后台任务、没有 job 表、不会提前返回 document_id。

推论，也是本轮明确否掉的一个设计：

- 客户端拿到响应时状态**已经是终态**，`pending` 对已登录调用方根本不可观测 → **做进度轮询是伪需求**。我因此把上传态实现为「按钮 pending + 一次索引重建提示」，而不是假造的进度条。
- 没有进度百分比、没有分阶段耗时、没有完成时间戳。要做真实进度，必须先做后端异步化（见 §7 第 3 项），前端才有东西可轮询。
- `chunk_count` 只在成功时存在、`index_error` 只在失败时存在 → 状态徽标必须容错。改版后 `meta` 缺失渲染为中性「无索引信息」，而不是此前那样一律落到红色（旧代码 `else → danger`，把"从没索引过"显示成"失败"，属于误导）。

## 6. 引用回溯：现在诚实能做到什么

引用对象由 `parse_references`（`llm/service.py:120-135`）拼装，最终字段集只有：

```
{ title, uploader, source, created_at, relevance_score, chunk_id }
```

对照"点引用回到原文"的三档需求：

- **(a) 回到文档**：做不到。引用**不含 `document_id` / `collection_id` / `database_name`**，只有 title（可重复），且 `uploader` 是硬编码的 `"admin"`。
- **(b) 回到该分块正文**：做不到。有 `chunk_id` 但没有 `doc_id`，无法调 `/document/chunk?doc_id=`；而且后端**没有按 `chunk_id` 取单块的端点**（service 层支持，controller 未暴露）。
- **(c) 页码/章节/坐标**：不可能。loader 本来产出 `page/coordinates/category/row`，在入库时被整段丢弃（只存 `content`，`models.py:128`、`documents/controller.py:122-125`）。

所以改版后的引用面板**只做只读展示**（序号、文件名、日期、分块号、相关性条、低相关告警），不挂"点击回溯"这种当前无法兑现的交互。上一轮审计还指出更根本的问题：prompt 要求模型输出 `[来源：文件名@页码]` 但从未把文件名/页码喂给模型，所以正文里的来源标注本身是幻觉——这条属于检索侧，不在本轮范围，但引用 UI 的克制正是为了不与它共谋。

## 7. 目标契约与前后端联动顺序

原则：`/api/relation/*` 为唯一真相源，`/api/vector/*` 降级为内部实现；所有列表统一 `{items, total, page, page_size}`；详情缺失返 404。

### 第一批（低风险，前端已按"没有也能跑"实现）

1. **列表统一分页/过滤/排序/total**：`GET /relation/database?page&page_size&q&sort`、`GET /relation/collection?database_id=`、`GET /relation/document?collection_id&q&status`。前端只需把 `useKnowledgeIndex` 换成服务端分页，组件层不动。
2. **详情按 id**：`GET /relation/database/{id}`、`/collection/{id}`，替掉按 name 的 `/get`；缺失返 404 而不是 `data:null`。
3. **规范化 DTO**：document 列表直接返回 `{id,title,uploader,created_at,index_status,chunk_count,error?}`，不再吐裸 ORM，也不再要前端去猜 `meta` 里有什么。

### 第二批（解锁前端新能力）

4. **引用补 `document_id` + `collection_id` + `database_name`**（`llm/service.py:131`）→ 解锁「点击引用跳到该文档」。这是引用 UI 从只读变可交互的唯一前提。
5. **暴露 `GET /relation/document/{id}/chunks?page&size` 与 `GET /relation/chunk/{chunk_id}`**（service 已有精确取块能力）→ 解锁块级回溯与「跳到第 N 块」。
6. **ingest 异步化 + `GET /relation/document/{id}/status`**（返回 `pending|indexing|indexed|failed` + 已处理块数）→ 才允许前端做真实进度，而不是我现在做的"提交即终态"。
7. **`DocumentChunk` 落 `meta`(page/heading/section) + `token_count` + `parent_chunk_id`** → 解锁页码/章节定位与小→大上下文。
8. **文档级 `DELETE`（PG + Milvus 同事务/补偿）与 `POST /relation/collection/{id}/index/rebuild`** → 解锁删除与重建按钮。当前控制台**故意不放删除按钮**，因为没有端点可绑，放了就是假 UI。

### 第三批（收口）

9. 合并两份 ingest 实现为单一 `IngestService`，删除 `/vector/document/upload`；`/vector/**` 的 reset 类操作移出公开路由或加 admin 门禁。
10. 上传携带真实 `uploader`（当前两处硬编码 `"admin"`），`Document.uploader` 改外键 → 对象归属校验才可能落地。
11. 去掉 `relation/collections/controller.py:66-67` 的 `except Exception: pass`（它吞掉 Milvus 删除失败，长期留下幽灵向量占据 top-k）。

### 前端已为这套契约做好的准备

`src/hooks/queries.ts` 把 queryKey、失效范围与失败 Toast 集中到一处，`useKnowledgeIndex` 是唯一需要替换的取数适配层——后端补齐分页后，改这一个 hook 即可让三级控制台整体切到服务端分页，页面组件不动。类型集中在 `src/types/knowledge.ts`，此前各页一律 `any`（字段名写错也不报错）。

## 8. 本轮控制台改版与后端事实的对应关系

| 后端事实 | 前端决策 |
|---|---|
| 定位向量集合需要 `(database_name, collection_name)` | 三级状态同时保留 id 与 name，上传时传 name |
| 四族资源无分页/计数 | 3 个全量请求建客户端索引，派生计数；客户端搜索/排序/分页 |
| ingest 同步、`pending` 不可观测 | 不做进度轮询，上传按钮 pending + 完成后失效重取 |
| `chunk_count`/`index_error` 只在特定终态存在 | 状态徽标四态：已索引 / 索引失败 / 排队中 / 无索引信息（中性，不再一律红色） |
| 引用无 `document_id` | 引用面板只读，不挂点击回溯 |
| 无文档 DELETE 端点 | 不提供删除按钮，避免假 UI |
| `code` 恒 200 | 一律以 HTTP status 判错，`apiClient` 不看 `code` |
