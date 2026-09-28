# Ametrine 重构基线文档

日期：2026-05-29

## 1. 重构目标

Ametrine 的下一阶段目标不是单纯增加模型能力，而是从一个 RAG 雏形系统，逐步整理为个人长期使用的半自动化 AI 工具。

核心定位：

- 以对话为主要入口。
- 以本地知识库、长期记忆、Agent 工具和语音交互为辅助能力。
- 让系统辅助使用者思考、整理、执行可控任务，而不是替代使用者做不可逆决定。
- 让未来维护者能够理解、迁移、恢复和继续使用。

目标能力：

- 基础 LLM 对话。
- RAG 检索问答。
- Agent 工具调用。
- ASR：通过麦克风提问，计划使用 Xinference + SenseVoiceSmall。
- TTS：将最终回答以语音形式播放，计划使用 Xinference + Kokoro。
- 对话、文档、记忆与工具调用具备可审计、可导出、可重建的存储设计。

## 2. 当前项目现状

### 2.1 后端

当前后端位于 `apps/backend`，主要技术栈：

- FastAPI
- LangChain / LangGraph
- Xinference
- Milvus
- PostgreSQL
- Redis
- SQLAlchemy async

主要模块：

- `src/llm`：基础对话、RAG 对话、rerank、prompt 拼接。
- `src/vector`：Milvus database、collection、document 操作。
- `src/relation`：PostgreSQL 中的 tenant、database、collection、document、chunk。
- `src/agent`：LangChain ReAct Agent 与工具封装。
- `src/base/auth`：JWT 登录认证和角色权限雏形。
- `src/client.py`：集中初始化数据库、Milvus、Redis、Xinference、tokenizer、splitter。

### 2.2 前端

当前前端位于 `apps/frontend`，实际是 Vue 3 + Vite 项目。

已有价值较高的部分：

- 核心对话页面体验已经比较符合个人使用习惯。
- 支持多 session、本地持久化、自动滚动。
- 支持 LLM / RAG / Agent 模式切换。
- 已有知识库选择交互。
- 已有基础主题能力。

当前主要问题：

- API 枚举和实际后端路由存在不一致风险。
- fetch、stream、错误处理、请求取消、鉴权没有形成统一 client。
- 流式解析依赖网络 chunk 边界，健壮性不足。
- UI 逻辑、会话状态、请求逻辑耦合较多。

## 3. 已发现的具体风险

### 3.1 向量检索与关系库一致性

当前文档上传流程大致为：

1. 上传文件到本地目录。
2. 解析文件并切 chunk。
3. 生成 embeddings。
4. 写入 PostgreSQL 的 `document` 和 `document_chunk`。
5. 写入 Milvus。

风险：

- PostgreSQL 写入成功后，如果 Milvus insert 失败，会留下半成品。
- 没有明确的 ingest 状态，例如 `pending`、`indexed`、`failed`。
- 删除文档时需要保证关系库和 Milvus 之间有可恢复策略。
- Milvus 应被视为可重建索引，而不是唯一事实源。

建议原则：

- PostgreSQL 保存原始事实数据。
- Milvus 保存可重建的语义索引。
- 所有 Milvus 数据必须能够从 PostgreSQL 和文件存储重建。

### 3.2 SQLAlchemy 查询条件风险

`apps/backend/src/relation/documents/service.py` 中 chunk 精确查询使用了 Python 的 `and`：

```python
DocumentChunk.doc_id == doc_id and DocumentChunk.id == chunk_id
```

这不是推荐的 SQLAlchemy 条件组合方式，可能导致查询条件不符合预期。

后续应改为：

```python
select(DocumentChunk).where(
    DocumentChunk.doc_id == doc_id,
    DocumentChunk.id == chunk_id,
)
```

或使用 `sqlalchemy.and_()`。

### 3.3 Milvus schema 写死

`apps/backend/src/vector/collections/service.py` 中：

- embedding 维度写死为 `1024`。
- metric type 写死为 `L2`。
- collection schema 只包含 `embedding`、`doc_id`、`chunk_id`。

风险：

- 更换 embedding 模型时容易维度不匹配。
- cosine / IP / L2 的选择与 embedding normalization 没有显式约束。
- 缺少 `tenant_id`、`database_name`、`collection_id`、`source_type`、`embedding_model`、`embedding_version` 等元数据。

建议：

- 将 embedding 维度、metric type、index type 配置化。
- 记录 embedding 模型名称和版本。
- 为检索增加必要 metadata filtering。

### 3.4 Milvus database 切换隐式化

`use_vector_database()` 装饰器会隐式调用：

```python
self.milvus_service.use_database(database_name)
```

风险：

- 数据库上下文隐藏在装饰器中，调试困难。
- 如果 MilvusClient 在请求之间共享，可能存在上下文污染风险。
- 异步并发场景下，隐式 mutable state 更难推理。

建议：

- 后续封装明确的 VectorRepository。
- 让每个操作显式传入 database / collection 上下文。
- 尽量避免在共享 client 上依赖隐式当前数据库状态。

### 3.5 Agent 工具权限风险

当前 `ShellTool` 被直接暴露给 Agent。

风险：

- Prompt injection 可能诱导 Agent 执行危险命令。
- 缺少工具调用前确认。
- 缺少命令 allowlist / denylist。
- 缺少审计日志。
- 工具输出可能携带敏感信息并进入模型上下文。

建议：

- Agent 工具默认最小权限。
- Shell 工具先进入禁用或受限模式。
- 高风险工具必须人工确认。
- 记录每次 tool call 的输入、输出摘要、执行状态、触发用户、时间。

### 3.6 前端流式协议不稳定

当前前端 `decodeChunks()` 直接按网络 chunk 解码，并尝试 `JSON.parse`。

风险：

- 一个 JSON 片段可能被拆成多个网络 chunk。
- 多个 token 可能合并在同一个网络 chunk。
- Agent、LLM、RAG 的流格式不一致。
- 错误事件、完成事件、引用事件缺少统一格式。

建议统一为事件协议：

```json
{"type":"token","content":"..."}
{"type":"reference","data":[...]}
{"type":"tool_call","data":{...}}
{"type":"error","message":"..."}
{"type":"done","conversation_id":"...","message_id":"..."}
```

前端只解析统一事件，不关心后端内部是 LLM、RAG 还是 Agent。

## 4. 目标架构

建议目标结构：

```text
React Frontend
  -> Ametrine Backend API
      -> Chat Service
      -> RAG Service
      -> Agent Service
      -> Audio Service
          -> ASR Adapter -> Xinference ASR Node
          -> TTS Adapter -> Xinference TTS Node
      -> Memory Service
      -> Tool Runtime
      -> Relational Repository -> PostgreSQL
      -> Vector Repository -> Milvus
      -> File Storage
      -> Audit Log
```

关键原则：

- 前端永远只请求 Ametrine Backend，不直接请求 Xinference。
- PostgreSQL 是事实源。
- Milvus 是可重建索引。
- 文件和音频进入文件存储，数据库只保存路径、hash、metadata。
- Agent 工具调用必须经过权限、确认和审计。
- ASR/TTS 是后端 adapter，不污染核心 chat API。

## 5. 数据设计草案

### 5.1 关系库建议新增或调整的实体

现有实体：

- `User`
- `Role`
- `Tenant`
- `Database`
- `Collection`
- `Document`
- `DocumentChunk`

建议新增：

- `Conversation`
- `Message`
- `MessageAttachment`
- `MemoryItem`
- `ToolCall`
- `AudioAsset`
- `EmbeddingJob`
- `AuditLog`

### 5.2 Conversation

建议字段：

- `id`
- `user_id`
- `title`
- `mode`
- `created_at`
- `updated_at`
- `archived_at`
- `metadata`

### 5.3 Message

建议字段：

- `id`
- `conversation_id`
- `role`
- `content`
- `status`
- `model`
- `token_usage`
- `created_at`
- `metadata`

说明：

- 对话原文必须存在关系库中。
- 前端本地 session 可以作为缓存，但不应是长期事实源。

### 5.4 MemoryItem

建议字段：

- `id`
- `user_id`
- `scope`
- `content`
- `sensitivity`
- `source_message_id`
- `enabled`
- `created_at`
- `updated_at`
- `metadata`

说明：

- 长期记忆必须可查看、可编辑、可删除。
- 敏感记忆默认不进入向量库，除非用户显式允许。

### 5.5 ToolCall

建议字段：

- `id`
- `conversation_id`
- `message_id`
- `tool_name`
- `input`
- `output_summary`
- `status`
- `risk_level`
- `requires_confirmation`
- `confirmed_by`
- `created_at`
- `finished_at`

### 5.6 Milvus metadata

建议每条向量至少包含：

- `source_type`
- `source_id`
- `chunk_id`
- `user_id`
- `tenant_id`
- `database_id`
- `collection_id`
- `visibility`
- `embedding_model`
- `embedding_version`
- `created_at`

## 6. API 契约草案

### 6.1 对话

建议最终统一入口：

```text
POST /api/chat
```

请求：

```json
{
  "conversation_id": "optional",
  "mode": "llm | rag | agent",
  "message": "用户输入",
  "rag": {
    "database_name": "default",
    "collection_name": "default"
  },
  "options": {
    "stream": true,
    "voice_reply": false
  }
}
```

响应：

- 非流式：标准 JSON。
- 流式：统一 SSE / NDJSON event。

### 6.2 文档

建议：

```text
POST /api/documents
POST /api/documents/{document_id}/index
DELETE /api/documents/{document_id}
POST /api/index/rebuild
```

### 6.3 音频

建议：

```text
POST /api/audio/transcriptions
POST /api/audio/speech
```

说明：

- 后端负责转发到 Xinference。
- 前端不保存 Xinference 地址、模型 uid、端口。
- ASR 和 TTS 节点可以独立部署。

## 7. React 前端迁移策略

不要一次性删除旧 Vue 前端。建议采用并行迁移：

1. 保留旧前端作为行为参考。
2. 在 `apps/frontend-react` 或重建 `apps/frontend` 前先确认目录策略。
3. 新 React 前端只先实现核心对话页。
4. API client 先行，UI 后行。
5. 完成 LLM/RAG/Agent 三模式闭环后，再迁移后台管理页。

React 前端建议结构：

```text
src/
  api/
    client.ts
    chat.ts
    audio.ts
    documents.ts
  domain/
    conversation/
    voice/
    agent/
    rag/
  components/
    chat/
    layout/
    controls/
  stores/
  types/
  utils/
```

前端核心要求：

- 统一 request client。
- 支持 AbortController 取消生成。
- 支持流式事件解析。
- 明确 loading / streaming / error / cancelled / done 状态。
- 不在 UI 组件中拼后端路由。
- 对话页面保留当前舒服的使用体验。

## 8. ASR/TTS 接入策略

建议第一阶段只做非流式闭环：

```text
麦克风录音
  -> 上传音频
  -> 后端调用 SenseVoiceSmall ASR
  -> 得到文本
  -> 调用 /api/chat
  -> 得到最终回答
  -> 后端调用 Kokoro TTS
  -> 前端播放音频
```

后续再做流式体验：

- ASR partial result。
- LLM token streaming。
- TTS 分段合成和渐进播放。

需要注意：

- SenseVoiceSmall 可能需要额外 VAD 依赖。
- Kokoro 中文语音需要确认模型、语言和 voice 参数。
- 音频文件应进入文件存储，数据库记录 metadata。
- 音频默认应设置保留策略，避免无限增长。

## 9. 安全原则

### 9.1 Agent 安全

- 工具默认关闭或低权限。
- Shell、浏览器、文件系统、网络访问视为高风险工具。
- 高风险工具必须确认。
- 工具调用必须审计。
- 工具输出进入模型上下文前应过滤敏感信息。

### 9.2 RAG 安全

- 检索内容视为不可信输入。
- 文档内容不能覆盖系统指令。
- 检索必须带权限过滤。
- 不同用户、租户、集合之间不能串数据。
- 引用来源必须可回溯。

### 9.3 记忆安全

- 长期记忆必须可见。
- 长期记忆必须可删除。
- 敏感记忆默认不向量化。
- 支持导出和清空个人数据。

### 9.4 API 安全

- 所有非公开 API 需要鉴权。
- 后端应校验对象归属。
- 不信任前端传入的 user_id、role、权限字段。
- 文件上传需要大小、类型、路径和解析超时限制。
- CORS、JWT secret、模型地址等必须配置化。

## 10. 分阶段重构路线

### 第 0 阶段：基线文档

目标：

- 记录当前架构。
- 记录已知风险。
- 明确长期设计原则。
- 作为后续重构的共同参照。

产出：

- `docs/refactor/00-baseline.md`

### 第 1 阶段：后端小修与契约冻结

目标：

- 修复明确 bug。
- 梳理路由和 DTO。
- 统一流式响应协议。
- 为 React 前端提供稳定接口。

候选任务：

- 修复 SQLAlchemy `and` 查询问题。
- 修正前后端路由不一致。
- 将 embedding dim / metric type 配置化。
- 给 streaming 增加统一事件格式。
- 给 RAG references 改成流式事件或稳定 response metadata。

### 第 2 阶段：RAG 与向量库重构

目标：

- PostgreSQL 成为事实源。
- Milvus 成为可重建索引。
- 文档 ingest 有状态、有失败恢复。

候选任务：

- 新增 `EmbeddingJob` 或 ingest 状态字段。
- 增加 Milvus metadata。
- 增加重建索引接口。
- 删除文档时同步处理 Milvus。
- 为检索增加 metadata filter。

### 第 2 阶段执行记录

2026-05-29 已完成第一批低风险改造：

- 文档上传时先在 PostgreSQL `Document.meta` 中记录 `index_status=pending`。
- Milvus insert 成功后更新为 `index_status=indexed`，并记录 `chunk_count`。
- Milvus insert 或后续索引流程失败时更新为 `index_status=failed`，并记录 `index_error`。
- 上传文件使用安全文件名，并在存储文件名前添加 UUID，降低路径穿越和重名覆盖风险。
- 文档 metadata 增加 `stored_path`、`sha256`、`embedding_model`。
- 新建 Milvus collection 时增加 `source_type`、`embedding_model`、`created_at` 字段。
- 插入向量时会检查 collection schema；旧 collection 没有新字段时仍按旧 schema 写入，避免破坏既有数据。
- RAG search 中 `release_collection` 移入 `finally`，避免查询异常后 collection 未释放。

仍待处理：

- 增加正式 `EmbeddingJob` 表或迁移方案。
- 增加文档删除时的 Milvus 同步清理。
- 增加一键重建索引接口。
- 增加 metadata filter，确保用户、租户、集合边界不会串数据。

### 第 3 阶段：会话、记忆、审计

目标：

- 对话记录进入关系库。
- 支持长期记忆。
- 支持工具调用审计。

候选任务：

- 新增 Conversation / Message。
- 前端本地 session 改为缓存。
- 新增 MemoryItem。
- 新增 ToolCall / AuditLog。

### 第 3 阶段执行记录

2026-05-29 已完成第一批数据骨架：

- 新增 `Conversation` 表定义。
- 新增 `Message` 表定义。
- 新增 `MemoryItem` 表定义。
- 新增 `ToolCall` 表定义。
- 新增 `AudioAsset` 表定义。
- 新增 `ChatHistoryService`，用于创建/复用 conversation 并写入 message。
- 新统一入口 `POST /api/chat` 已开始保存用户消息和助手最终回答。

设计取舍：

- 旧 `/api/llm/*` 和 `/api/agent/*` 暂不写入新会话表，避免一次性改变旧前端行为。
- 新表通过现有 `Base.metadata.create_all` 创建；正式长期使用前仍建议补 Alembic 或等价迁移机制。
- `MemoryItem`、`ToolCall`、`AudioAsset` 目前先建立数据骨架，后续阶段再逐步接入业务流程。

仍待处理：

- 给 conversation/message 增加列表、详情、删除、归档接口。
- Agent 工具调用写入 `ToolCall`。
- 长期记忆提取、确认、编辑、删除流程。
- 数据导出和清空流程。

### 第 4 阶段：React 前端迁移

目标：

- 构建 React + TypeScript + Tailwind 前端。
- 保留现有对话页体验。
- 使用统一 API client。

候选任务：

- 新建 React 工程。
- 实现 chat API client。
- 实现 streaming parser。
- 迁移消息列表、输入框、模式切换、知识库选择。
- 增加取消生成、错误状态、重试。

### 第 4 阶段执行记录

2026-05-29 已完成第一版并行 React 前端：

- 新增 `apps/frontend-react`，不删除旧 Vue 前端。
- 使用 React + TypeScript + Tailwind + Vite。
- 新增统一 API client。
- 新增 `/api/chat` SSE parser，按 `data: ...\n\n` 帧解析，不依赖网络 chunk 边界。
- 新增核心对话页面：模式切换、RAG database/collection 输入、消息列表、停止生成、错误展示。
- 新 React 前端 dev server 使用 `8001` 端口，避免和旧 Vue `8000` 冲突。

校验：

- `apps/frontend-react`: `yarn install` 成功。
- `apps/frontend-react`: `yarn build` 通过。
- `http://127.0.0.1:8001` 返回 200。

### 第 5 阶段：ASR/TTS

目标：

- 完成语音输入和语音回答闭环。

候选任务：

- 新增 AudioService。
- 新增 Xinference ASR adapter。
- 新增 Xinference TTS adapter。
- 前端新增录音状态机。
- 前端新增音频播放队列。

### 第 5 阶段执行记录

2026-05-29 已完成第一版非流式语音闭环地基：

- 新增后端 `src/audio` 模块。
- 新增 `POST /api/audio/transcriptions`，转发到 Xinference `/v1/audio/transcriptions`。
- 新增 `POST /api/audio/speech`，转发到 Xinference `/v1/audio/speech`。
- 新增 `XINFERENCE_TTS_MODEL_ID` 配置，默认值为 `kokoro`。
- React 前端新增 audio client。
- React 前端麦克风按钮可录音并调用 ASR，转写结果会放入输入框。
- React 前端语音播放按钮会把最近一条助手回复发给 TTS 并播放返回音频。

仍待处理：

- 将音频文件 metadata 写入 `AudioAsset`。
- 增加录音时长、文件大小、音频格式限制。
- 增加 TTS 播放队列和分段合成。
- 在 Xinference 节点实际加载 SenseVoiceSmall/Kokoro 后做端到端语音测试。

### 第 6 阶段：长期维护与传承

目标：

- 让未来维护者能理解和恢复系统。

候选任务：

- 写部署文档。
- 写数据备份与恢复文档。
- 写模型替换指南。
- 写安全边界说明。
- 增加导出个人数据功能。
- 增加一键重建索引功能。

### 第 6 阶段执行记录

2026-05-29 已完成第一批安全骨架：

- Shell Agent 工具默认关闭，需要显式设置 `AGENT_SHELL_ENABLED=true` 才能启用。
- Shell 工具增加基础危险命令拦截。
- 新统一入口 `POST /api/chat` 在 Agent 模式下会将 `tool_call` 事件写入 `ToolCall` 表。

仍待处理：

- 高风险工具调用前的人类确认机制。
- Tool output 摘要与敏感信息过滤。
- AuditLog 表和统一审计中间件。
- 数据导出、删除、恢复文档。
- 部署文档和模型替换指南。

## 11. 第一批建议执行任务

建议下一步从第 1 阶段开始，先做小而确定的后端修复：

1. 修复 `DocumentChunk` 精确查询条件。
2. 修正前后端文档上传 API 路由不一致。
3. 抽出 Milvus embedding dim / metric type 配置。
4. 给 RAG 检索结果增加更明确的数据结构。
5. 为 streaming response 定义统一事件格式，但可以先兼容旧前端。

这些任务风险低、收益高，并且会为后续 React 迁移打地基。

### 第 1 阶段执行记录

2026-05-29 已完成：

- 修复 `DocumentChunk` 精确查询条件，避免使用 Python `and` 组合 SQLAlchemy 条件。
- 修正前端上传文档 API：`/api/vector/upload_single` -> `/api/vector/document/upload`。
- 修复前端 `uploadFile()` / `uploadImage()` 未提交 `FormData` 的问题。
- 将 Milvus host、port、embedding dimension、metric type、index type、index nlist 抽入配置。
- 新增统一对话入口 `POST /api/chat`，用于后续 React 前端迁移。
- 新增统一流式事件协议：`token`、`reference`、`tool_call`、`error`、`done`。
- 保留旧接口 `/api/llm/chat`、`/api/llm/rag`、`/api/agent/chat`，避免旧前端立刻失效。
- 修复旧前端两个构建错误：RAG drawer 查询 collection 时补齐 `database_name`，document 页面补齐 `ElMessage` 导入。

校验：

- 后端：`python -m compileall apps/backend/src apps/backend/main.py` 通过。
- 前端：`yarn build` 通过。

新增 `/api/chat` 流式事件示例：

```text
data: {"type":"token","content":"..."}

data: {"type":"reference","data":[...]}

data: {"type":"tool_call","data":{"tool":"...","tool_input":"..."}}

data: {"type":"error","message":"..."}

data: {"type":"done","conversation_id":"..."}
```

## 12. 暂不做的事

为了避免重构失控，以下事项暂不进入第一阶段：

- 不立即删除 Vue 前端。
- 不立即重写全部后端目录结构。
- 不立即接入 ASR/TTS。
- 不立即引入复杂权限系统。
- 不立即替换 LangChain / Xinference / Milvus。
- 不立即做多用户生产级部署。

## 13. 项目原则

Ametrine 应保持这些产品和工程原则：

- 可理解优先于炫技。
- 可恢复优先于隐式自动化。
- 用户确认优先于 Agent 自作主张。
- 关系库保存事实，向量库服务检索。
- 记忆必须可查看、可修改、可删除。
- 工具调用必须可审计。
- 前端体验可以温柔，但后端边界必须清楚。

## 14. 后续审计

- `docs/refactor/2026-09-28-rag-audit-and-ui.md`：对标生产级 RAG 的完整缺陷清单（租户隔离失效、中文文档未分块、rerank 未重排、引用契约不成立等），以及前端设计令牌化与 UI 专业改版的记录。本文件 3.x 与第 1~6 阶段的部分「已修」结论在该文档中被重新核实。
- `docs/refactor/2026-09-28-backend-contract-and-console.md`：后端契约与资源模型审计。回答「Milvus collection 归属谁、四族资源缺哪些端点、为什么不该做入库进度轮询、引用回溯现在能做到哪一步」，并给出前后端联动改造顺序与知识库控制台改版对应关系。
- `docs/refactor/2026-09-28-frontend-review-round2.md`：第二轮前端横向评估（真实运行环境下）。侧栏分区重构的实际原因、租户与用户管理合并为「组织与权限」、色彩语义收敛（只有异常才着色）、错误从写进正文改为可行动提示，以及动效层与仍未做的诚实清单。
- `docs/refactor/2026-09-28-backend-evaluation.md`：后端调研评估（逐段读码、附 `path:line`）。检索链路三个实现级 bug（rerank 从不全局排序、命中块取成最低分、无命中时返回字符串导致空上下文）、租户边界与鉴权缺位清单、会话持久化断在 `ensure_conversation` 未写 `user_id`（前端 localStorage 依赖的真实成因）、日志与响应信封等运维基线，以及「与专业 RAG 的差距对标表」和三批改造顺序。同批记录前端收尾：`strict` 从未开启现已打开、`check` 门禁、高亮包 979 kB 拆分、dev 默认 HTTP、明暗两套主题 WCAG AA 实测 0 违例。文档末尾追加一节记录**《丛书》whisper 模块已整体删除**（实测证明它从未生效：`is_active` 全为 NULL 使注入恒为空串、`/api/chat` 路径根本没接、配置表无 `user_id` 却摆在个人设置里、四个端点无鉴权），以及删除后仍留在台面上的 `user.system_prompt` 死控件。
- `docs/refactor/2026-09-28-palette-motion-and-session-correctness.md`：命令面板（⌘K，含 ARIA combobox 模式与权限一致的候选集）、删除会话的收起动画与 reduced-motion 直删，以及被这套动画逼出来的两个真实状态 bug——`useSessionMessages` 会把已删除会话的 URL ID 重新写回 store（幽灵会话），`deleteSession` 的后继会话跨模式串味。附删除链路与面板的实测结果；以及后续三节——深链指向已删除资源改为五态明确报错（`utils/drilldown.ts`）、分页收敛为单一实现（越界页不再「空表 + 第 5 / 1 页」，`utils/pagination.ts`）、路由守卫不再因非 401 错误把有效登录态踢回登录页（带来路深链与开放重定向防护，`utils/redirect.ts`）；以及加载态骨架屏（`DataTable` 保留表框不再整块塌陷，`.skeleton` 从死代码变成默认加载形状）、`prefers-reduced-motion` 补 `animation-iteration-count` 以免 infinite 动画变成高频闪烁、快速上手引导改用共用 `Modal` 并修好「误触遮罩永久失去引导」与「三步引导走不完」、知识库控制台按 URL 深度给加载骨架（避免第一帧把合法深链误判成「这个知识库不存在」）。§20 记录一个已定位未动手的缺陷：裸 `/chat`、`/rag` 路由访问即在后台建会话，含两条改法取舍与为什么不能用半刀切。
- `docs/refactor/2026-09-28-white-screen-and-backend-dependency.md`：两类「白屏」的根因与修复，以及 xinference 依赖的彻底处理。跳转白屏是 `<main key={pathname} className="anim-page">` 每次导航重建整块正文并从 `opacity:0` 入场；部署后首屏全白是旧 `index.html` 引用了已被新构建替换的哈希分片（入口脚本 404 时 JS 无法自救），靠 nginx 缓存策略 + 启动看门狗 + `vite:preloadError` 单次重载 + 根级 ErrorBoundary 分层解决。依赖侧的关键实测：`uv` 报的「依赖冲突」其实是**环境里的 HTTP 代理让清华索引返回 403**（绕开代理同一请求 200 且能解出 `xinference 3.5.0`），而真正的结构问题是 `[all]` extra 拉进 `vllm 0.7.2` 并硬锁 `torch==2.5.1`；新 xinference 已把 vllm 移成独立 extra，于是拆出 `apps/inference/`（不装 vllm，`uv lock` 实测 360 包含 torch 2.14）并重写 `load_models.sh` / `wait_for_models.sh` / `dev.sh`。同批落地后端第一批修复：rerank 全局排序、命中块取最高分、无命中返回 `[]`、请求路径里的 `exit(0)`、`/user/**` 与 `/api/chat` 鉴权（含自我升管理员与越权读写他人会话）、`ensure_conversation` 补 `user_id`、日志真正写进文件。

