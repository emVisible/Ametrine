# 2026-09-28 对标审计与前端 UI 改版

审计方式：以生产级 RAG 知识库（混合检索 + 重排 + 引用契约 + 评测回归）为基准，逐文件核对后端检索链路，并在浏览器中实测渲染结果验证前端改版。下文结论均给出实际读取到的 `文件:行号`。

## 1. 阻塞性问题（正确性与租户隔离）

### 1.1 `/api/chat` 完全没有鉴权（最严重）

`src/chat/controller.py:150-156` 的依赖只有 `get_llm_service / get_document_service / get_chat_history_service`，没有 `get_current_user`；`_stream_rag`（`controller.py:51-72`）直接拿请求体里的 `rag.database_name / collection_name` 去查询，从不校验归属。对比旧入口 `src/llm/controller.py:67` 是有 `require_read_database` 的。

后果：未登录客户端可以指定任意 `database_name`（= 任意租户的 Milvus database）检索并让模型复述其内容。README 与 Refactor 主推的统一入口，恰好是权限最薄弱的那个。**租户隔离在该入口上等于不存在。**

### 1.2 `role_id` 可自写 → 提权后全库可读

`src/user/controller.py:41-48` 的 `PATCH /api/user/{user_id}` 无鉴权，`UserUpdate`（`src/user/dto.py:19`）含 `role_id`，`src/user/service.py:82-84` 无字段白名单直接 `setattr`。`role_id=3` 即 `is_admin`（`src/user/permissions/service.py:68-71`），使 `can_read_database / can_write_database` 恒真（:94、:123）——连旧入口的检查也一并绕过。同文件 `POST /create`（:9）与 `DELETE /delete?user_id=1`（:51）同样裸奔。

### 1.3 `/api/vector/**` 管理面含破坏性操作且无鉴权

- `src/vector/databases/controller.py:64` `/database/reset`：删除所有 Milvus database 并 `DELETE FROM tenant`。
- `src/vector/collections/controller.py:111-124`：按库清空、跨全部租户清空所有 collection。
- `src/vector/documents/controller.py:10-27`：`/document/search`、`/document/upload` 无鉴权。

### 1.4 全库正文可被无鉴权批量导出

`src/relation/documents/controller.py:27-53` 的 `/all`、`/chunk?doc_id=` 无鉴权、无分页、无归属校验，直接返回所有 `DocumentChunk.content`。"引用可回溯"的反面，是任何人都能拖走整个知识库。

### 1.5 中文文档实际没有分块（已在本次修复）

`.env:37 SEMANTIC_SPLITTER=True` → `src/client.py:96-104` 走 `SemanticChunker(..., breakpoint_threshold_type="gradient")`，其默认断句正则实测为 `(?<=[.?!])\s+`（`.venv/lib/python3.12/site-packages/langchain_experimental/text_splitter.py:119`），要求标点后跟空白。中文 `。！？` 后没有空格，实测 `re.split` 只返回 1 段，命中同文件 `:220-221` 的 `if len(single_sentences_list) == 1: return` 提前返回分支。

> 一篇中文文档 = 1 个 chunk = 1 条向量。`CHUNK_SIZE=512 / CHUNK_OVERLAP=64` 完全失效（这两个参数只喂给被绕过的 `RecursiveCharacterTextSplitter`）。这是当时检索质量的首要杀手。

**已修**：`src/client.py:96-107` 传入 `sentence_split_regex=r"(?<=[.?!。？！;；])\s*"`，实测同一段中文从 1 段变为 5 段。

注意代价：SemanticChunker 会对每个句子做一次 embedding，中文长文档的入库耗时与调用量会显著上升。若更看重吞吐，`SEMANTIC_SPLITTER=False` 回到 512/64 递归切分是合理的替代方案——两种都比修复前好。

### 1.6 其他确定性缺陷

| 问题 | 位置 | 说明 |
|---|---|---|
| 一批管理接口必崩 | `vector/databases/controller.py:32` vs `relation/tenants/service.py:69` | `create_tenant(name=, database_name=, database_description=)` 只收 `name` → `TypeError`。README「租户与数据库一一绑定」在 API 上走不通 |
| dict 当 ORM 用 | `vector/databases/controller.py:59-60`、`vector/collections/controller.py:56-58`、`relation/databases/service.py:132` | `db.tenant.name` / `db.id` / `delete(db)` 作用在 dict 上 |
| 裸 SQL 字符串 | `vector/databases/service.py:61` | `execute("DELETE FROM tenant")`，SQLAlchemy 2.0 不支持 → `ObjectNotExecutableError` |
| `Tenant.owner_id` 不存在却被引用 | `permissions/service.py:148` vs `models.py:68-76` | 且 `models.py:88` 把一对多反向端写成 `uselist=False` |
| `unify_filter` 用字符串当哨兵 | `llm/service.py:118` + `:137-143` | 返回 `list \| str`；`if context` 对非空字符串为真，逐字符迭代后 reference 变空串，「无参考信息」提示永不触发 |
| 流式首块 KeyError | `llm/service.py:37` | 无条件取 `chunk["choices"][0]["delta"]["content"]`；Xinference 首块与 `finish_reason` 块无 `content`。`chat/controller.py:23-25` 已修，说明两条路径已分叉 |
| 会话 IDOR | `conversation/service.py:63-67` | `update_title` 无归属校验（同文件 `get_messages` 有）；`chat/history.py:28-36` 建会话从不写 `user_id`，`/conversation/list` 永远看不到这些会话 |
| `chat_history.role` 未校验 | `llm/dto/chat.py:7-11` | 无 `Literal` 约束，客户端可注入任意 `role:"system"` 消息 |
| CORS 与密钥 | `main.py:76,94` | `white_list` 含 `"*"` 且 `allow_credentials=True`；`.gitignore` **没有 `.env` 条目**，而 `apps/backend/.env` 真实存在并含 `SECRET_KEY` |
| Agent 能力并不存在 | 全仓 | `src/agent` 目录不存在、无注册、`config.py` 无 `AGENT_SHELL_ENABLED`，但 `ChatRequest.mode` 允许 `"agent"` 且 `chat/controller.py:170-173` 静默降级为 llm。README 的 Playwright/Wikipedia/DuckDuckGo/Shell 无对应代码 |

### 1.7 事件循环上的同步阻塞（吞吐天花板）

只有 rerank 走了 `run_in_executor`（`llm/service.py:96`）。`embed_query / embed_documents`（`vector/documents/service.py:39,72`）、pymilvus 的 `load_collection / has_collection / search / insert / release`（:33-46,116）、`llm_model.chat` 的建连与逐块迭代（`llm/service.py:36`、`chat/controller.py:40`）、`redis_client.setex/get`（`llm/controller.py:77,104`）全部同步。单并发即可拖死整个服务，`SEMAPHORE=32` 形同虚设——而且 `llm/controller.py:41-45,80-92` 的 `async with` 只包住返回 generator 的那次调用，真正的流式迭代发生在信号量之外。

另外 `vector/documents/service.py:36,46` 每次检索都 `load_collection → finally release_collection`：A 请求释放会打断正在搜索的 B 请求。Refactor 第 2 阶段把 release 移进 `finally` 这条「修复」本身引入了并发正确性问题。

## 2. RAG 检索质量缺口

### 2.1 无混合检索

- 专业：dense + sparse（BM25）双路召回，RRF 融合后再 rerank；专有名词、代码符号、错误码、版本号靠 sparse 兜底。
- 现状：纯 dense top-k（`vector/documents/service.py:37-43`），全仓 grep `BM25|sparse|hybrid|filter=` 零命中。
- 影响：型号/错误码/函数名类查询召回接近 0，而这恰是知识库最高频的查询。
- 改法：bge-m3 本身可输出稀疏权重 → Milvus 加 `SPARSE_FLOAT_VECTOR` 字段 + `hybrid_search` + `RRFRanker`；或先用 PG 的 `pg_trgm/tsvector` 做关键词路（PG 已是事实源，成本最低）。

### 2.2 检索宽度被钉死

`limit=10` 硬编码（`service.py:42`），`search()` 从不传 `params`，IVF_FLAT + `nlist=256`（`collections/service.py:80-88`）取默认 nprobe。召回上限锁死在 10，且这 10 条本身就在漏——rerank 救不回没进候选的答案。

改法：`RETRIEVAL_TOP_K=100` 与 `RERANK_TOP_N=3` 分离；个人库规模下直接用 `FLAT`，或传 `params={"nprobe": max(16, nlist)}`。

### 2.3 rerank 从不「重排」

`llm/service.py:68-88` 对每个候选**单独**调一次 rerank（每次 `texts` 长度为 1），`unify_filter`（:103-118）按 Milvus 原始返回顺序 append，最后 `res[:p]` 取「原序前 3」，全程没有按 `relevance_score` 排序。跨编码器分数只被用作过滤。rerank 的价值丢了一半以上。

改法：一次批量调用 + 按分数降序排序后再截断。

### 2.4 引用契约与「文档回溯」不成立

`src/llm/prompt.py:83` 要求模型输出 `[来源：文件名@页码]`，但 `create_user_prompt`（`llm/service.py:137-143`）把 chunk **裸文本 `"\n".join"`**，既无编号也无文件名/页码。loader 本可提供 `page/category/coordinates/row` 等 metadata，却在 `vector/documents/service.py:97-115` 与 `relation/documents/service.py:72-77`（只存 `content` 一列）被全部丢弃。

后果：**模型只能编造文件名和页码——这是系统提示词主动要求的幻觉。** references 是检索后另算的一份列表（`parse_references`），与正文毫无对应关系。README 宣称的「文档回溯」实际只到「给个文档标题」。

改法：`DocumentChunk` 增 `meta JSONB`（page/heading/section）与 `token_count`、`parent_chunk_id`；context 渲染成 `[1] (来源: 标题, p.3)\n<text>`；输出后解析 `[n]` 并与真实集合交叉校验，未命中的引用直接拒绝。

### 2.5 无提示注入防线

`src/llm/prompt.py:2-9` 把 reference 直接 f-string 插进用户 prompt，无分隔符、无「其中指令均为数据」的声明。配合 1.1 的无鉴权入口，构成完整利用链：一篇含「忽略以上指令」的文档即可劫持回答。

### 2.6 token 预算与截断方向错误

`llm/service.py:145-150` 用 `max_model_len`(30000) 截 prompt 尾部，而 `llm/controller.py:90`、`chat/controller.py:38,82` 又把同一个值当 `max_tokens` → 30000+30000 必然超上下文。且参考资料排在 prompt 末尾，砍尾巴会把 chunk 从句子中间剁断，把半句话当事实交给模型，也没有任何「上下文已截断」标记。另外 `TOKENIZER_ADDR` 指向 Qwen2.5-3B 而 LLM 是 Qwen3-Instruct，计数模型不匹配。

### 2.7 距离 → 相关性分数的语义混乱

`.env` 未设 `MILVUS_METRIC_TYPE` → 默认 **L2**（`config.py:29`），而 bge-m3 输出未归一化，L2 对语义检索本就劣于 COSINE；向量 `distance` 在 `llm/service.py:73` 被直接丢弃；前端展示的 `relevance_score` 实际是 rerank 的 sigmoid 值（:114），与「向量匹配度」不是一个量纲，`MIN_RELEVANCE_SCORE=0.3` 对 sigmoid 分布极松。UI 应标明这是「重排相关性」，阈值需用问答集标定。

### 2.8 无查询改写 / 无去重 / 无父子块

检索只喂原始 `prompt`（`llm/controller.py:68-70`、`chat/controller.py:60-64`），`chat_history` 只进生成不进检索——「那它的价格呢？」这类指代追问必然跑偏。rerank 结果无 `doc_id` 去重（`llm/service.py:106-115`），3 个 prompt 槽位可能被同一文档相邻块吃掉。PG 无 `parent_chunk_id`，命中子块拿不到章节上下文。

### 2.9 无评测、无可观测性

仓库无 tests/eval 目录、无 golden set。`@log`（`middleware/logger.py:97-177`）只挂在 `/llm/chat`、`/llm/rag` 上，**`/api/chat` 完全没有**；`log_execution`（:140）量的是「返回 StreamingResponse 对象」的耗时，流式真实延迟测不到；`config_logger.propagate = False`（:31）使请求日志根本不写进 `ametrine.log`。分阶段耗时与命中的 chunk_id + 分数一律不留痕 → **任何一次 RAG 改动都无法判断是变好还是变坏**。

## 3. 工程一致性与可运维性

- **两套并存的 ingest 实现**：`vector/documents/service.py:54-133` 与 `relation/documents/controller.py:65-166` 各写一遍「存文件→分块→embedding→PG→Milvus→改状态」，返回契约与错误处理分叉。应收敛为单一 `IngestService`。
- **一致性未闭环**：`index_status` pending/indexed/failed 确实写了（`vector/documents/service.py:89,119,128`）、`sha256` 确实算了（:67）；但无补偿事务、无 `EmbeddingJob` 表、**无文档级 DELETE 接口**，`relation/collections/controller.py:66-67` 用 `except Exception: pass` 吞掉 Milvus 删除失败 → **幽灵向量长期占据 top-k，直接压低有效召回**。grep `rebuild` 零命中，「Milvus 可重建」仍是口号。
- **N+1 与写放大**：一次问答 30+ 次往返——每候选 1 次 PG SELECT（`llm/service.py:74-76`）+ 1 次 rerank HTTP + 每候选 1 次 document SELECT（:126-130，`document_describe_service` 未判空 `relation/documents/service.py:52-53`，文档被删即 `AttributeError`）。`DocumentChunk.doc_id`（`models.py:130`）**无索引**，精确查全是全表扫。
- **所有权事实缺失**：两处上传都硬编码 `uploader="admin"`（`vector/documents/service.py:85`、`relation/documents/controller.py:105`），`Document.uploader` 是 String 无外键 → Refactor 9.4 要求的对象归属校验无从落地。
- **连接与资源**：`client.py:45-46` 每请求新建 `MilvusClient` 且从不关闭（gRPC channel 泄漏）；`audio/service.py:17-19` 每请求新建 Redis 且从不关闭；`main.py:82,85` `route_audio` 重复注册。
- **迁移缺失**：`alembic/versions` 只有 2 个 revision，`Conversation/Message/MemoryItem/ToolCall/AudioAsset/UserDatabasePermission/TenantMember` 全靠 `main.py:100-102` 的 `create_all`；`client.py:54-57` 还留着 `drop_all` 的 `reset_relation_db`（误调用即清库）。
- **SSE 协议三套并存**：`llm/service.py:37`（裸 JSON + 单 `\n`）、`llm/service.py:45-66`（`text/thought/tool_call/done`）、`chat/controller.py:18-20`（`token/reference/tool_call/error/done` + `\n\n`）。Refactor 第 1 阶段「已统一」仅对 `/api/chat` 成立，旧 `/api/llm/*` 一个字节没改。
- **前端与协议脱节（已修）**：`api/chat.ts` 走的是旧 `/llm/chat`、`/llm/rag`；`streamChat` 根本不带 Authorization；引用靠 `X-Session-ID` 响应头 + Redis 600s 异步取，且 `GET /references` 无鉴权、`ref_json=None` 时 `loads(None)` 直接抛。
- **依赖**：`python-multipart`（`Form/File` 必需）只在 `uv.lock` 传递解析（:5640），换环境即整条上传路径不可用；`langchain-milvus`、`tiktoken`、`pdf2image`、`bitsandbytes` 声明未使用。

## 4. Refactor.md 既有条目核实

| 条目 | 状态 | 证据 |
|---|---|---|
| 3.2 SQLAlchemy `and` 条件 | 已修 | `relation/documents/service.py:83-88` |
| 3.1 `index_status` / `sha256` | 部分 | `vector/documents/service.py:67,89,119,128`，无补偿、无 EmbeddingJob |
| 3.3 dim/metric/index 配置化 | 部分 | 已配置化，但默认仍 `L2`（`config.py:29`），`.env` 未覆盖 |
| 3.3 Milvus 元数据字段 | 部分 | 只有 `source_type/embedding_model/created_at`（`collections/service.py:70-74`）；5.6 列的 `tenant_id/user_id/database_id/collection_id/visibility/embedding_version` 全缺 |
| 3.4 隐式 `use_database` | 未修 | `utils/other.py:9-19`，且只认 kwargs，导致 `vector/documents/controller.py:15` 崩 |
| 3.5 Agent 工具加固 | 无对应代码 | `src/agent` 不存在；`logger.py:82-84` 却在打印该配置标签 |
| 3.6 统一 SSE 事件协议 | 部分 | 仅 `/api/chat` |
| 第 2 阶段「release 移入 finally」 | 已实现但引入并发缺陷 | `vector/documents/service.py:46` |
| 第 2 阶段待办（删除同步 / 重建 / metadata filter） | 全部未做 | 无 document DELETE；grep `rebuild` 零命中；search 无 `filter=` |
| 第 3 阶段会话落库 | 部分且有缺陷 | `chat/controller.py:157-168`；`chat/history.py:28-36` 不写 `user_id` |
| 第 6 阶段 ToolCall 写入 | 死代码 | `chat/controller.py:130-137`，上游无 tool_call 产生者 |

## 5. 前端 UI 专业化改版（本次已完成）

改版原则：**保留原有的简洁**，只替换掉「玩具感」的三个来源——emoji、通用 indigo 配色、缺失的设计层级。

### 5.1 设计令牌系统（`src/index.css` 重写）

- 建立语义令牌：`canvas / surface / surface-raised / surface-sunken / surface-hover`、`line / line-strong / line-subtle`、`ink / ink-muted / ink-subtle`、`accent` 七级、`success / warning / danger` 三态。
- 令牌在 `:root` 与 `.dark` 下整组切换，组件层不再散落 `dark:` 变体（改版前每个元素都要写两遍颜色，是「不一致」的根源）。
- 主色从通用 indigo 换成呼应 Ametrine（紫水晶）的紫罗兰：浅色 `#5a4bd4`，深色 `#9c8ff5`，均按 WCAG 对比度选取。
- 排版比例收敛：UI 基准 14px，标题负字距，数字统一 `tabular-nums`（指标刷新时不再跳动）。
- 新增可复用控件基元 `.a-btn / .a-input / .a-card / .a-badge / .a-table / .a-section-title`，管理页从此靠同一套语义组合而非重复堆 className。
- 补 `:focus-visible` 焦点环、`::selection`、滚动条、`prefers-reduced-motion`。

### 5.2 图标语言（新增 `src/components/icons.tsx`）

统一 24 网格 / 1.5 描边 / `currentColor` 的内联 SVG 图标集。实测页面内 emoji 归零（`/login`、`/dashboard`、`/rag`、`/admin/vector` 全部 `hasEmoji=false`）。

### 5.3 应用外壳（`src/components/AppLayout.tsx` 重写）

- **修复真实缺陷**：`SidebarContent` 原先定义在组件函数体内，每次渲染都是新的组件类型 → React 卸载重挂载整个子树，侧栏搜索框每敲一个字就失焦。已提取为顶层组件。
- **修复 P0**：`createSession` 返回 `Promise<string>`，而旧代码 `const id = createSession(mode); navigate(\`/chat/${id}\`)` 会跳到 `/chat/[object Promise]`。已改为 await。
- 顶栏 + 侧栏 + 移动端底部导航三处重复的导航收敛为单一侧边导航面；移动端改为抽屉 + 仅移动端可见的窄顶栏。
- 导航改用 `NavLink`（支持中键新开、键盘可达、`aria-current`），会话列表按「今天 / 昨天 / 近 7 天 / 近 30 天 / 更早」分组并按活跃时间排序。
- 删除会话后若正停留在该会话，自动跳回列表路由（此前会留在已删除的 URL 上）。
- 品牌图标由 `src` 导入，替换掉写死的 `/src/assets/icon.png`（生产构建下必然 404）。
- 版本号原本指向不存在的 `/changelog` 路由（点击即 404），改为静态标识。

### 5.4 对话页

- 新增 `src/components/chat.tsx`（`MessageList / MessageRow / Composer / EmptyState`），Chat 与 RAGChat 共用同一栅格。实测两者列宽均为 864px——此前消息列 `max-w-4xl` 与输入框 `max-w-3xl` 视觉错位。
- 消息形态从「聊天气泡」改为带角色标注的文档式排版，长文本与代码块不再被气泡宽度挤压；每条回答附复制按钮。
- 新增**停止生成**（AbortController）与滚动跟随（用户向上翻阅时不再被强制拉回底部）。
- 引用面板改为可回溯的结构化列表：序号、标题、上传者/日期/分块号/文档号、相关性条。去掉 green/yellow/red 红绿灯配色，只保留单一强调色 + 一处低相关提示。
- RAGChat 此前**完全不落 session store、不读 `convId`**，切换会话即丢失历史；且 `enableRerank` 开关从未传给后端（纯装饰）。两者均已修复。
- `api/chat.ts`：`streamChat` 补上缺失的 Authorization；解析层同时兼容 SSE `data:` 帧与 NDJSON，非 JSON 行不再被静默丢弃（原实现一旦后端按 SSE 返回就一个字都渲染不出来）；403/401 与网络错误分流；`session_id` 改为 `encodeURIComponent`。

### 5.5 其余页面

`Dashboard`（去掉 `"—"` 假指标，改为真实统计 + 入口列表 + 知识库状态表）、`Settings`（内联提示改为 Toast，且不再用 `message.includes("失败")` 猜测成功与否）、`OnboardingTour`（emoji → 图标，补 `role=dialog`、ESC/遮罩关闭、进度条）、`ErrorBoundary`、`Toast`（统一中性卡片 + 状态图标 + 关闭按钮 + 堆叠上限）、`Markdown`（代码块语言标签与复制按钮、表格改用统一表样式、行内代码不再是红色）、`VoiceInput`（`alert()` 改 Toast、录音计时、卸载时释放麦克风轨道）、`Admin*`（配色令牌化，`✓`/emoji 清除）。

### 5.6 顺带修复的前端工程问题

- **构建本就是坏的**：`index.css` 引用 6 个 `.ttf`，而 `.gitignore` 含 `*.ttf` → 仓库根本没有字体目录，构建报「didn't resolve at build time」、运行时静默 404，自定义排版从未生效。已移除失效声明，改为「本机装有霞鹜文楷则优先使用，否则回退中文系统字体栈」。
- `yarn build`（= `tsc -b && vite build`）**此前必然失败**：`stores/index.ts` 空壳 store 触发 `TS6133`。已连同未被任何地方引用的 `App.tsx`（内容是 `<div className="bg-positive-low">123</div>`）一并删除。
- `sessionStore.createSession` 原先直接取 `result.id`，后端返回结构变化时会静默造出 `id=undefined` 的会话（实测复现过 `/rag/undefined`）。已加校验并回退本地 UUID。

### 5.7 验证方式与边界

Windows 侧无法访问 WSL 内端口，因此改版是把 `dist` 打包到主机上用本地静态服务器 + mock API 加载的，再通过浏览器读取真实 DOM 计算样式验证：

- 设计令牌在亮/暗两套下均正确解析（`--c-accent` `#5a4bd4` ↔ `#9c8ff5`，body 底色随主题切换）。
- `/login`、`/dashboard`、`/rag`、`/admin/vector`、`/register` 的 emoji 全部为 `false`，旧色板类名（gray/indigo/green/red/yellow/blue/purple）在页面 DOM 中为零。
- 无横向溢出；侧栏 240px、导航 `NavLink` active 态正确、会话按「今天 / 近 7 天 / 近 30 天」分组。
- 对话页消息列与输入列同为 864px（错位问题消除）；Rerank 开关、textarea、集合下拉的禁用态与占位文案符合预期。
- 新建会话后 URL 不再出现 `[object Promise]`；品牌图标由构建期内联为 data URI（`naturalWidth > 0`），证实 `/src/assets/icon.png` 硬路径已修。
- `tsc -b` 与 `vite build` 均通过，且不再有 6 条字体解析告警。
- 顺带修正 `index.html`：`lang="en"` → `zh-CN`，favicon 的 `type="image/svg+xml"` → `image/png`，补 `color-scheme` / `theme-color` / 描述；`ThemeProvider` 首次访问改为跟随系统偏好而非强制浅色。

**未做的验证**：没有像素级截图确认（in-app browser 无可见渲染面，改以 DOM 计算样式代替）；未接通真实后端做端到端联调——登录、SSE 流式、引用回溯、上传索引都需要跑起 Xinference + Milvus + PostgreSQL 后实测；第 1.5 节的分块修复只在正则层面验证，尚未对真实文档重跑索引确认 chunk 数与召回变化。

`Admin / AdminTenant / AdminVector / Profile` 这几页本次只做了配色令牌化与 emoji/`✓` 清除，版式结构未重构——它们已继承同一套 `.a-card / .a-table / .a-btn` 语义，但与对话页相比改版深度较低。


## 6. 建议优先级

### P0 正确性与安全（先于任何质量优化）

1. `/api/chat` 加 `get_current_user` + `require_read_database`，且 database/collection 由服务端从授权集合推导，禁止客户端直传 —— `src/chat/controller.py:51-72,150-195`
2. `/api/user` 全端点鉴权；`UserUpdate` 移除 `role_id` —— `src/user/controller.py:9-59`、`src/user/dto.py:14-24`
3. `/api/vector/**` 与 `/api/relation/document/**` 全端点鉴权，`/database/reset`、`/collection/reset`、`/document/all|chunk` 加 admin 校验并分页
4. CORS 去掉 `"*"`；`.gitignore` 补 `.env` —— `main.py:76,90-97`
5. rerank 改批量调用 + 按分数降序再截断 —— `src/llm/service.py:68-118`
6. prompt 预算与 `max_tokens` 分离，按 chunk 装箱、禁止句内截断 —— `src/llm/service.py:145-150`、`src/llm/controller.py:90`、`src/chat/controller.py:38,82`
7. 阻塞调用移出事件循环（`asyncio.to_thread` 包 embed/pymilvus/redis），修信号量作用域；去掉每次检索的 `release_collection`
8. 修 `create_tenant / delete_tenant / database_get_*` 的签名与 dict/ORM 混用、`Tenant.owner_id` 缺失
9. 删除或真正实现 Agent：`ChatRequest.mode` 去掉 `"agent"`，别再静默降级（`chat/controller.py:170-173`），并同步 README

### P1 检索质量与隔离

10. Milvus schema 补 `tenant_id/user_id/collection_id/visibility/embedding_version`，search 注入**参数绑定**的 filter 表达式，开 `enable_dynamic_field`
11. sparse/BM25 双路 + RRF 融合
12. 检索宽度可配（`RETRIEVAL_TOP_K` / `nprobe`），小库改 FLAT
13. metric 改 COSINE 并服务端归一化 embedding；UI 明确分数语义为「重排相关性」
14. chunk metadata 落库 + `[1..n]` 编号引用契约 + 输出 marker 校验
15. 不可信内容用 `<context>` 包裹并声明其中指令均为数据
16. 多轮查询改写（condense-question）+ MMR + `doc_id` 去重 + 邻块合并
17. 父子块（small-to-big）建模
18. 文档级 DELETE（PG + Milvus 同事务/补偿）与 `/index/rebuild`；去掉 `except Exception: pass`
19. 两份 ingest 实现收敛为单一 `IngestService`

### P2 可运维性

20. 检索快照（候选 doc_id/chunk_id/distance/relevance_score/分阶段耗时）写入 `Message.meta`；`/api/chat` 纳入日志；修 `propagate=False` 与流式耗时统计
21. 30–50 题中文 golden set + recall@k / nDCG 离线回归脚本（建议 `apps/backend/eval/`）
22. N+1 消除、`DocumentChunk.doc_id` 加索引
23. `MilvusClient` 进程级单例；Redis 复用注入
24. Alembic 补齐第 3 阶段建表迁移，移除 `reset_relation_db` 的 `drop_all`
25. 日志 DSN 脱敏改为真正遮蔽密码；`unify_filter` 字符串哨兵改为规范返回类型
26. `python-multipart` 提为直接依赖；去掉 `main.py` 重复 `route_audio`
27. 前端切到统一 `/api/chat` 事件协议，废弃 `X-Session-ID` + Redis 取引用的旁路
