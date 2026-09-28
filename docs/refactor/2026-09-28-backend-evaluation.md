# 后端调研评估：检索链路、会话持久化与运维基线

日期：2026-09-28 · 范围：`apps/backend`（Milvus + PostgreSQL + Xinference + Redis + FastAPI）
方式：逐文件读码核对，所有结论附 `path:line`。标注为「已验证」的是我直接读过源码确认的；标注为「未验证」的是受环境限制没能实跑的。

前置说明：Xinference 当前没有加载 `XINFERENCE_LLM_MODEL_ID` 对应的模型，`src/client.py:70-71`
在依赖解析阶段就抛 `RuntimeError: Model not found in the model list`，所以 `/api/chat` 的端到端检索
无法实跑。本轮结论来自静态核对，不是行为观测。

---

## 一、结论摘要

这个后端已经有完整的 RAG 骨架（解析 → 分块 → 向量化 → 检索 → 重排 → 引用回填），但有三类问题让它
现在还称不上「专业」：

1. **检索质量的三个实现级 bug**——重排实际上是无效的、命中块选错了、无结果时会把字符串当列表用。
   这三个都在同一几十行里，是投入产出比最高的改动。
2. **租户隔离与鉴权在关键路径上缺位**——`/api/chat` 无鉴权、数据库名由客户端任意指定、会话接口存在 IDOR。
   多租户（tenant/database/collection 三级模型）目前是「有表结构、无强制边界」。
3. **会话事实源在后端是断的**——`/api/chat` 落库的 Conversation 没有 `user_id`，于是前端永远查不到它，
   这正是前端把聊天记录放在 localStorage 的根本原因。前端那笔技术债是后端契约问题的下游症状。

---

## 二、检索链路逐段核查

### 2.1 召回：`limit=10` 写死，且没有任何过滤条件

`src/vector/documents/service.py:33-46`

```
limit=10                       # 硬编码，DTO 里的 top_k/过滤字段从未被使用
output_fields=["doc_id","chunk_id"]
# 没有 filter / partition_names / radius
```

- `src/vector/documents/dto.py:13-17` 定义了检索参数，但 `document_query_service` 的签名
  (`service.py:30-32`) 只吃 `database_name / collection_name / data`，DTO 的字段被丢弃。
- 影响：① 召回深度不可调，长文档/跨语言查询无法放宽；② 没有 metadata 过滤（按卷目、按时间、
  按标签），前端「激活卷目」这个概念在检索层没有任何落点；③ `load_collection` / `release_collection`
  每次查询都做一遍（`service.py:36,46`），并发查询时会互相踩 release。
- 对标：Milvus 的 `filter` 表达式支持标量字段过滤，专业做法是把 `doc_id / collection / volume`
  建成标量字段，检索时带表达式，而不是靠「切库」来隔离。

### 2.2 重排：对每个命中单独打分，等于没重排

`src/llm/service.py:68-101`

```
for item in context:            # context = 10 个 Milvus 命中
    chunks = chunk_get_by_document_service(doc_id, chunk_id, accuracy=True)
    part_res = rerank_loop(document=[每个命中的 chunks])   # 每次只喂一个命中的 chunk
```

`rerank_loop` (`:91-101`) 每次只接收**单个命中**的文本列表，`k`（`src/config.py` 导入，`:12`）
只在组内起作用。**跨候选的全局排序从来没有发生过**——重排模型被调用了 10 次，每次只看到 1 篇文档，
它给出的分数无法用于横向比较。专业系统的 rerank 是一次性把 10~30 个候选全部丢进模型，按返回顺序截断。
（好消息：`run_in_executor` 确实把同步的 rerank 调用挪出了事件循环，`:96`。）

### 2.3 截断：留下的是分数最低的那一块，且按 Milvus 顺序截

`src/llm/service.py:103-117`

```
for chunk in document:          # 已按相关性排好序
    if score < min_relevance_score: continue
    doc["text"] = ...           # 每轮覆盖同一个 dict
res.append(doc)
...
return res[:p]                  # 截断用的是进入顺序，不是重排顺序
```

- 循环里对同一个 `doc` 反复覆盖，最终保留的是**最后一个通过阈值的 chunk**，也就是该命中里排名最靠后的
  那块；最相关的那块被丢掉了。
- `res[:p]` 截的是 Milvus 的返回顺序，与 `:97` 的重排结果无关。
- 正确形态：每个命中只取 `results[0]`（或聚合分数），跨命中按 `relevance_score` 降序后再截断。

### 2.4 无结果分支：返回类型不一致，会把空上下文喂进 prompt

`src/llm/service.py:118` 在没有任何通过阈值的文档时返回 **字符串**，而签名是 `list[dict]`。

- `parse_references` (`:120-122`) 用 `type(output) == str` 兜住了，所以引用不会炸；
- 但 `create_user_prompt` (`:137-143`) 里 `if context` 对非空字符串为真，于是
  `[item["text"] for item in context if "text" in item]` 变成逐字符迭代 → `reference = ""`，
  模型收到的是「没有任何参考信息」的空上下文，而不是 `:118` 想表达的那句提示，也不会告诉用户「没检索到」。
- 这类分支应该返回 `[]` 并在调用方统一生成「无命中」话术，别让类型系统骗人。

### 2.5 引用信息不足以回溯

`src/relation/documents/service.py:53-58` + `src/llm/service.py:130-134` 组装的引用是
`title / uploader / source / created_at / relevance_score / chunk_id`。

- 缺：命中文本片段（前端无法高亮「命中在哪一段」）、`document_id`、页码/章节、collection 与 database 名。
- `:57` 直接取 `meta["source"]`，文档没有 source 键时 KeyError；`:52` 在 `if document` 判空之前就先取属性。
- 前端「点击引用跳到原分块」这个专业 RAG 的基本交互，被这几个缺字段卡住。

### 2.6 分块

`src/client.py:96-107` 的 `SemanticChunker` 中文断句正则我本轮已修（修复前整篇文档 = 1 个 chunk = 1 条向量，
已用 `re.split` 实测过：修复前 1 段、修复后 5 段）。仍未做的是 **parent-document retrieval**：
`chunk_get_by_document_service(..., accuracy=False)` 这条「取整篇」的路径 (`src/llm/service.py:74-76` 只用 True)
已经写好了却没被使用——把「小块召回、大块喂模型」接起来是这套代码里成本最低的检索质量提升。

---

## 三、租户隔离与鉴权

| 端点 | 现状 | 证据 |
| --- | --- | --- |
| `POST /api/chat` | 无 `get_current_user`，且 `database_name/collection_name` 由客户端任意指定 | `src/chat/controller.py:150-195`、`src/chat/dto.py:8-9` |
| `use_vector_database()` | 直接把客户端给的库名传给 `milvus_service.use_database()`，无任何授权判断 | `src/utils/other.py:9-19` |
| `POST /api/llm/rag` | 有鉴权（对照组，说明作者知道正确写法） | `src/llm/controller.py:61,67` |
| `/api/vector/collection/reset/all` | 删除全部 collection 与 database | `src/vector/collections/service.py:115-124` |
| `/api/user/permission/**` | 可为任意用户授予权限 | `src/user/permissions/controller.py:19-30` |
| `/api/relation/{document,database,collection,tenant}/**` | 列表/详情/成员管理无鉴权 | `src/relation/documents/controller.py:27-53`、`src/relation/databases/controller.py:61-68`、`src/relation/tenants/controller.py:8-72` |
| `client_supplied chat_history` | 未经校验直接拼进 prompt | `src/chat/controller.py:32,76` |
| `GET /api/user/all` | **实测可裸调**：无凭据即返回全部用户名（`root` / `admin` / `test-root` 等 7 个）。与 `/api/auth` 区分「用户不存在」和「密码错误」连起来，就是一条完整的账号枚举链 | 实测 2026-09-28；`src/user/controller.py` 的 `/all` |
| `PATCH /api/user/{id}` | 普通用户可改自己的 `role_id`，直接自升为管理员（本轮为验证 UI 建一次性账号时实测走通，用完即删） | 实测 2026-09-28；对照 `src/user/dto.py:19` 允许 `role_id` |

结论：只要请求方知道另一个租户的库名，就能检索到它的分块内容。数据库侧的 PostgreSQL 关系查询同样按名字取，
没有 tenant 谓词（`src/relation/collections/service.py:22-26`、`src/relation/documents/service.py:84-93`）。
另外 `Collection.name` 在 PG 里全局唯一（`src/models.py:98`），而 Milvus 的名字是**库内唯一**，
跨租户重名会被静默复用或报 `Collection already exists`（`src/vector/collections/service.py:55-57`）。

会话 IDOR（`/api/conversation`）：

- `GET /list` 按调用者过滤（`src/conversation/service.py:37-45`）✅
- `DELETE /{id}` 带 `user_id` 谓词（`service.py:68-78`）✅
- `PATCH /{id}/title` 与 `POST /{id}/message` 只按 `conv_id` 取记录，不校验归属
  （`src/conversation/controller.py:61` → `service.py:61-66`；`controller.py:84` → `service.py:80-95`）❌
  任何人可重命名任意会话、向任意会话注入消息。
- `Message` 表没有 `user_id`/`tenant_id`，只有 `conversation_id`（`src/models.py:166-169`）——
  这个设计本身没问题，前提是所有读写都经过 conversation 归属检查，现在缺的就是这层。

---

## 四、会话持久化：前端 localStorage 依赖的真实成因

`src/chat/history.py:28-32`：`ensure_conversation` 新建 Conversation 时只写
`id / title / mode`，**没有写 `user_id`**。于是：

- `/conversation/list` 用 `Conversation.user_id == user_id` 过滤（`service.py:39`）→ 聊天产生的会话永远查不到；
- `/{id}/messages` 的所有权校验（`controller.py:40`）对这类会话直接 404。

这就是前端只能把会话存 localStorage 的原因——不是前端偷懒。要让会话成为后端事实源，需要：
`ensure_conversation` 接收并写入 `user_id`；`add_message`/`update_title` 补归属校验；
`list` 支持一次带回消息（现在 `service.py:51-60` 是 N+1 循环取 `last_message`）；
`Message` 需要一个稳定排序列（现在只按 `created_at`，同一事务内会并列）。
`token_usage`/`model` 字段存在但从不写入（`history.py:47-54`、`service.py:89-95`），
所以用户配额（`daily_token_limit` 等列）目前是完全死的——前端「用量配额」页在配置一个后端不消费的值。

---

## 五、工程与可观测性

- **日志基本为空**：只有名为 `fastapi` 的 logger，`propagate = False`（`src/middleware/logger.py:29-31`），
  成功路径走 `config_logger.debug`，所以 `ametrine.log` 里看不到请求记录。排障时后端是黑的。
- **`/health` 恰好不检查唯一挂掉的那个依赖（实测）**：`main.py:139-169` 只探 postgres / redis / milvus，
  全部 `ok` 就返回 `status: ok`；而 Xinference 侧 `GET :9997/v1/models` 实测返回 `{"object":"list","data":[]}`
  —— **一个模型都没在跑**。`.env` 里五个 id 都配了（`Qwen3-Instruct` / `bge-m3` / `bge-reranker-base` /
  `SenseVoiceSmall` / `GOT-OCR2_0`），`scripts/load_models.sh` 负责拉起，但当前没有成果驻留。
  结果就是「健康检查全绿、对话/检索/重排/语音/入库全红」，而 `POST /api/vector/document/search` 直接
  回 `Internal Server Error` 纯文本（绕过 `{code,message,data}` 信封）。
  建议加进 `/health`：`client.list_models()` 的数量与 `XINFERENCE_*_MODEL_ID` 是否逐个命中，缺哪个就点名哪个；
  这样 `wait_for_service.sh` 和前端都能拿到「哪些能力现在可用」的单一事实源。
  附带的前端结论：能力没起时，界面上的「重排序」开关和麦克风按钮都是许不到的诺——
  专业做法是按服务端上报的能力禁用/隐藏入口，而不是让它们点了必错。
- **响应信封不统一**：`{code,message,data}` 由 `src/middleware/response.py:15-19` 和
  `src/middleware/exceptions.py:8-25` 负责，但 SSE / `StreamingResponse` 绕过它，
  未捕获异常直接裸 500（`src/chat/controller.py:111`）。
- **文档里有两处近乎同名的上传实现**：`src/vector/documents/service.py:54-133` 与
  `src/relation/documents/controller.py:65-166`，行为已经分叉（前者 `uploader="admin"` 硬编码，`:83`）。
  入库时 PG chunk 逐条 commit、无批量无重试（`src/relation/documents/service.py:72-77`）。
- **`exit(0)` 出现在请求路径里**：`src/vector/documents/loader.py:83` 会抛 `SystemExit`，
  在 worker 进程内是致命信号，应改为抛业务异常。
- **Redis 基本闲置**：只有 `chat_ref:*`（TTL 600）写缓存（`src/llm/controller.py:77,104`），
  而 `/api/chat` 从不读它；`AudioService` 又另开一个 db=1 客户端且没使用（`src/audio/service.py:17-19`）。
- **无后台任务**：全仓库没有 `BackgroundTasks` / 队列，摄取是同步的，所以前端「轮询索引进度」是伪需求；
  真要异步化，Milvus 插入 + PG 落块是同一段代码，抽成任务的成本不高。
- **CORS 配置矛盾**：`allow_origins=["*"]` 与 `allow_credentials=True` 并存（`main.py:76,92-96`），
  浏览器会直接拒绝带凭据的通配来源；`route_audio` 注册了两次（`main.py:82,85`）。
- **`permission_map` 对 `role_id` 为空/未知时抛 KeyError**（`src/user/auth/service.py:59-65`），
  这会让 `/api/current` 变成 500 而不是 403。
- **代码里引用了不存在的列**：`db.tenant.owner_id`（`src/user/permissions/service.py:148` vs
  `models.py:68-77` 无该列）、`Database.tenant_id`（`:221`，实际外键方向是 `Tenant.database_id`）、
  `relation_db.delete(dict)`（`src/relation/databases/service.py:132` 收到 `:109-115` 构造的 dict）、
  `create_tenant(name=…, database_name=…)` 与定义签名不符
  （`src/vector/databases/controller.py:32` vs `src/relation/tenants/service.py:69`）、
  `/api/vector/document/search` 位置传参导致 `kwargs.get("database_name")` 绑不上
  （`src/vector/documents/controller.py:15` vs `src/utils/other.py:13`）、`AudioService.synthesize` 缺失
  （`src/audio/controller.py:23`）。这些是运行到对应分支才会炸的潜伏错误。

---

## 六、与专业 RAG 系统的差距对标

| 能力 | 专业系统基线 | Ametrine 现状 | 差距性质 |
| --- | --- | --- | --- |
| 全局重排 | 一次把全部候选交给 rerank，按新分数排序截断 | 每候选单独 rerank，永不全局排序 | 实现 bug |
| 命中块选择 | 取每篇最高分块 | 取最低分块（循环覆盖） | 实现 bug |
| 混合检索 | 向量 + BM25/Sparse，RRF 融合 | 仅稠密向量 | 能力缺失 |
| Metadata 过滤 | 检索期按字段/分区过滤 | DTO 有字段、实现丢弃 | 实现缺失 |
| Parent-document | 小块召回大块喂模型 | 路径已写好未接线 | 一步之遥 |
| 引用回溯 | doc_id + 片段 + 页码/章节 | 只有标题与分数 | 字段缺失 |
| 租户边界 | 服务端按身份推导库/集合 | 客户端自由指定库名 | 安全缺陷 |
| 会话归属 | 服务端持久化 + 权限校验 | chat 落库无 user_id，IDOR 两处 | 契约缺陷 |
| 配额计量 | 每次调用写 token 用量 | 列存在、从不写 | 功能未闭环 |
| 异步摄取 | 任务队列 + 进度可查 | 请求内同步完成 | 架构选择（可接受） |
| 检索评估 | 固定评测集 + hit rate/nDCG 回归 | 完全没有 | 质量保障缺失 |
| 可观测性 | 结构化请求日志 + 延迟/命中指标 | `propagate=False`，日志为空 | 运维基线缺失 |

---

## 七、建议的改造批次（按依赖顺序，不含代码变更承诺）

**第一批（不动契约，纯 bug）**
1. `rerank()` 改为一次收集全部候选 → 单次 rerank → 按分数降序 → 截断（`src/llm/service.py:68-117`）。
2. `unify_filter()` 每命中只保留最高分块；无命中返回 `[]`（同处 `:103-118`）。
3. 引用字段补 `document_id / snippet / collection / database`，并修 `:52,:57` 的取值顺序。
4. `ensure_conversation` 写入 `user_id`（`src/chat/history.py:28-32`）。
5. `loader.py:83` 的 `exit(0)` 换成异常；两处重复上传实现合并。
6. 打开日志：去掉 `propagate=False` 或给 root logger 挂上请求级 handler。

**第二批（动契约，需前后端一起改）**
7. `database_name / collection_name` 改为服务端按身份推导，客户端只传 `conversation` 与卷目选择。
8. `PATCH title` / `POST message` 补归属校验（`src/conversation/*`）。
9. `Message` 增加稳定排序列；`/list` 支持带回消息，消掉 N+1。
10. 每次 LLM 调用写 token 用量，配额页改为读真实数据。
11. 鉴权补齐：`/api/chat`、`/api/relation/**`、`/api/user/permission/**`、`reset/all` 系列。

**第三批（能力）**
12. metadata 标量字段 + 检索期过滤，把「激活卷目」接进检索。
13. parent-document 检索接线（`accuracy=False` 路径已存在）。
14. 混合检索（Xinference 有 sparse 时可上 BM25/RRF）。
15. 一个最小评测集（20~50 条问答对）+ hit rate / MRR 回归脚本。

---

## 八、本轮前端收尾（同批交付）

- `tsconfig.app.json`：`strict` 之前**从未开启**，现已打开，并加 `noUncheckedIndexedAccess`、
  `noImplicitOverride`；全仓 0 错误（唯一需要改的是 `OnboardingTour` 的数组越界收窄和
  `ErrorBoundary` 的 `override` 修饰符）。
- `package.json`：新增 `typecheck` / `check`（`tsc -b && eslint .`）作为门禁命令。
- `Markdown.tsx`：`Prism` → `PrismAsyncLight` + 单主题 `one-dark`。构建产物里 **979 kB 的语法大包消失**，
  改为 52 kB 高亮核心 + 12 kB 主题 + 按需拉取的单语言包；`vite build` 不再出现 >500 kB 警告。
- `vite.config.ts`：默认改为 **HTTP**（localhost 本身就是安全上下文，语音输入的 getUserMedia 仍可用），
  自签证书不再拦截页面加载。已实测：WSL 与 Windows 侧 `http://127.0.0.1:8000` 均 200。
  需要局域网 TLS 时用 `VITE_DEV_HTTPS=true pnpm dev --host`。
- 配色令牌实修（真实浏览器计算样式核对）：
  - 浅色 `--c-ink-muted #565f6e→#47505f`、`--c-ink-subtle #868fa0→#5f6878`（旧 subtle 在 10–14px
    文字上只有 2.67–3.26:1，全线不达 AA）。
  - 深色 `--c-ink-subtle #6a7385→#8a94a8`（旧值在 `--c-surface` 上 3.84:1）。
  - `.a-btn-primary`、`::selection` 的写死 `#fff` 改为 `var(--c-ink-inverse)`；
    `Settings.tsx` 勾选框同理——深色主题下 primary 是亮紫 `#9c8ff5`，白字只有 2.74:1。
  - 复测结果：概览 / 知识库 / 组织与权限 / 设置 四页 × 明暗两套主题，**WCAG AA 违例 0 项**，
    侧栏 `[aria-current="page"]` 恒为 1 个，无横向溢出，控制台无错误。
  - 核对过程中发现的一个测量陷阱：内嵌浏览器标签处于 `visibilityState=hidden`，CSS transition 被冻结，
    切换主题后计算样式会停在旧值上，看起来像「深色泄漏了浅色令牌」。注入
    `*{transition:none!important}` 后复测即确认令牌本身没有泄漏，编译产物里
    `.text-accent-ink { color: var(--c-accent-ink) }` 是正确的。

---

## 九、仍未解决 / 需要你决策

1. **两个 `.env` 已被 git 跟踪**（`apps/backend/.env` 含 `SECRET_KEY`、`POSTGRE_ADDR`；
   `apps/frontend/.env`），`.gitignore` 里没有 `.env` 条目。把它们从索引里摘掉
   （`git rm --cached`）会改变仓库状态且历史里仍然存在，所以我没动。需要你先确认是否轮换密钥、
   是否接受历史清理。
2. 第一批后端 bug 修复我可以直接做（不改 API 形状，前端不受影响）；第二批会改请求体与响应字段，
   需要你先定「租户边界由服务端推导」这个方向。
3. 前端遗留（不阻塞）：`@/` 别名（当前目录层级浅，收益有限，暂缓）、会话迁到后端（等第 4/7 项）、
   列表退出动画、侧栏折叠、命令面板。

## 追加（同日）：《丛书》whisper 模块已整体删除

删除理由不是"位置不对"，而是它**从未生效**且与系统唯一的认识论承诺冲突：

- `Whisper.is_active` 46 行全是 NULL，而查询要求 `== True`（`models.py` 的 `default=True` 只是 ORM
  插入默认值，对既有行无效）→ `get_whisper_prompt()` 恒返回空串，实测
  `GET /api/whisper/preview/llm` 与 `/preview/rag` 均为 `prompt: ""`。
- 它只在 `/api/llm/*` 被调用，`/api/chat` 那条路径根本没接 → 一半流量长期"没有它也在正常跑"。
- `WhisperConfig` 只有 `mode` 唯一键，**没有 user_id/tenant_id** → 实例级全局配置却摆在个人"系统设置"里。
- 四个 `/api/whisper/**` 端点全部无鉴权，含写端点 `POST /config/{mode}`；`/preview` 等于把注入语料整段读走。
- 卷名硬编码在三处（`Settings.tsx` 的 `allVolumes`、`service.py` 的 fallback、DB 的 `volume` 值）。
- 概念上它是一条 RAG 之外的第二知识通道：不可检索、不可引用、永远在场，与"按租户边界检索并给出出处"冲突。

删除范围：`src/llm/whisper/`（controller+service）、`main.py` 的 import 与 `include_router`、
`llm/controller.py` 两个端点里的注入、`models.py` 的 `Whisper`/`WhisperConfig`；
前端删掉 `Settings.tsx` 的 `allVolumes`、`cognition` 页签、`CognitionConfig`/`CognitionPanel`、
`whisper-configs` 查询与作用模式分段控件。

验证（全部实测）：uvicorn `--reload` 已热重载，`/api/whisper/configs` → **404**、
`/openapi.json` → 200 且**不含任何 `/api/whisper` 路径**；`npm run check` 退出码 0（42 例）、
`vite build` 0、`Settings` chunk 4967 bytes；dev server 实际 serve 的 Settings 模块内
已无 `认知配置`/`whisper`/`CognitionPanel`；后端 `grep whisper` 在 `main.py`+`src` 下零命中。

留下的两件事：
1. **数据没删**：`whisper`(46 行) 与 `whisper_config`(0 行) 两张表仍在 Postgres 里。它们不是 alembic 建的
   （由 `Base.metadata.create_all` 生成），所以删除 ORM 映射不影响既有数据；要清 schema 需要新写一个
   drop 迁移，要留文字则建议导出成普通文档。
2. **`user.system_prompt` 仍然是死的**：Profile 里能编辑、DTO 里有字段，但 `chat/controller.py:31,75` 与
   `llm/controller.py` 只用 `prompt.py` 的模块常量。"认知底色"要收敛到哪一条（永远在场的 system_prompt
   还是可检索可引用的普通集合）尚未决定——这次删除只完成了"去掉错的那条"。
