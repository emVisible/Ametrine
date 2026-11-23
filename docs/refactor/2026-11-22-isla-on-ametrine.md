# Isla on Ametrine：C 端 + B 端一体化升级方案

> 状态：规划已定，待执行
> 日期：2026-11-22
> 基线：Ametrine `5b66061`；Isla `0562d6a`
> 目标：Ametrine 同时承载 B 端知识库与 C 端个人 Agent；默认对话助手为 Isla；技能库独立成仓，不融合。

## 1. 结论

Isla 不再维护第二套地基。Ametrine 作为唯一底座，Isla 作为 Ametrine 的 Personal Agent 能力层。

- **UI 全部用 Ametrine。** Isla 的界面只作交互参考，不迁组件、不保留视觉体系。
- **能力只有一层。** C 端与 B 端共用账号、租户、文档、检索、引用、会话、模型、配额、审计。差别只在业务入口、数据范围与调用策略。
- **Isla 的账本与记忆是 Ametrine 缺的能力，不是外挂。** 以 `personal_*` 模块进入 Ametrine 内核；Isla 就是系统本身，不是可选人格。
- **技能库独立。** 书房/skill 不再属于 Ametrine 或 Isla，迁到 `~/Code/Skillshelf`，以后用文件系统、HTTP 或 MCP 组合。

一句话：**Ametrine 是知识库版本的 Hermes；Isla 是它的个人 Agent 模式。**

## 2. 现状与合并原则

### 2.1 两个仓的真实强弱

| 维度 | Ametrine | Isla |
|---|---|---|
| 账号/租户/权限 | JWT、tenant/member、permission | 单用户 |
| 文档 | 多格式 loader、collection、chunk、引用 | 无 |
| 检索 | Milvus 稠密 + rerank；无 BM25 | FTS5 + sqlite-vec + RRF 混合 |
| 会话 | Conversation/Message、SSE、历史 | ChatTurn + 前端 store |
| 记忆 | `MemoryItem` 是死模型，无服务 | 完整记忆门、痕迹、强度、撤回、失效 |
| 账本 | 无 | append-only JSONL + hash chain |
| 派生 | 无 ontology/periods/decisions | ontology/periods/aliases/decisions |
| 管理台 | 模型、租户、权限、队列、向量 | 无 |
| 配额 | token 日/月配额 | 无 |
| 前端 | 17k 行，完整壳子 | 6.2k 行，个人页面 |
| 测试 | 后端 0 个 pytest；前端 10 个测试文件 | 后端 212 个、前端 26 个 |
| 运维 | Postgres + Redis + Milvus + etcd + MinIO + Xinference | 单进程 + SQLite |

结论：Ametrine 强在平台能力，Isla 强在个人记忆与证据纪律。合并方向是 **Ametrine 提供平台，Isla 提供 Personal Agent 内核**。

### 2.2 合并原则

1. **一个能力层，不做 C/B 两套后端。** 用 `mode`、`scope` 区分业务，不用分叉代码。
2. **Ametrine 的 UI 是唯一 UI。** Isla 页面按 Ametrine 的组件、主题、i18n、路由重写。
3. **复用优先，删除优先。** 能删的 Isla 基础设施一律删，不搬。
4. **账本是真相，其余可重建。** 记忆、本体、周期、决定、别名都是派生；删了能重算。
5. **模型只判断，不写。** 记忆门、引用、决定仍由代码裁决；模型输出必须可校验。
6. **文档不是记忆。** 知识库文档进入检索，不自动进入个人记忆；只有人明确保留的原话才进记忆。
7. **技能库解耦。** 不在 Ametrine/Isla 里复制 skill 代码或数据；只通过适配器调用。
8. **测试是行为不变量，不是进度。** 不 1:1 搬 212 个测试；先列不变量，再写新测试。
9. **注释只写 why。** 不再用长注释/长文档代替功能。

## 3. 目标形态

### 3.1 一个 Ametrine，两个业务模式

```text
Tenant
  ├── mode = knowledge   B 端知识库
  │     scope = documents + collections
  └── mode = personal    C 端个人 Agent
        scope = personal_ledger + documents(optional)
```

- 同一个 `user`、同一个 `tenant` 表、同一套 JWT/权限/配额。
- `tenant.mode` 决定默认入口、数据范围与可见导航。
- B 端可以打开 personal 能力（私有记忆），C 端可以挂知识库（个人文档）。
- 不建两套账号，不建两套文档，不建两套模型配置。

### 3.2 系统身份

- Isla 是系统级身份，不是请求参数，也不是可选人格。没有 `assistant` 字段。
- personal 租户：`/` 与 `/chat` 默认落在个人空间；knowledge 租户落在知识库。
- 同一个 `/api/chat`：context 由租户数据范围、权限与当前会话自动组装；客户端不能指定「用哪个助手」。
- 个人原话与文档可以同时进上下文，但引用类型分开：`ev-*` 与 `passage:*`。
- 回答仍走证据门：只引用本轮提供的来源；引用必须可点开。

## 4. 模块边界

### 4.1 保留并复用的 Ametrine 模块

- `src/user`：账号、JWT、角色、租户成员、权限。
- `src/relation`：database/collection/document/chunk。
- `src/vector`：文档解析、分块、Milvus、引用召回。
- `src/chat` / `src/conversation`：会话、SSE、历史、消息。
- `src/llm`：生成、RAG prompt、rerank、telemetry。
- `src/inference`：模型绑定、Xinference 客户端、活性探测。
- `src/user/quota.py`：token 配额。
- 管理台、i18n、主题、AppLayout、AuthScreen。
- `scripts/doctor.py`、`init_db.py`、`create_admin.py`、`rag-bench` 作为运维与评测基线。

### 4.2 新增 `src/personal/`

```text
src/personal/
  ledger.py        append-only 账本、hash chain、JSONL 导出
  memory.py        记忆门、phase、strength、reasons、evidence
  context.py       个人上下文组装（L0–L7）
  resolve.py       指代/别名/日期/人
  periods.py       天/周/月/季/年（视图或按需查询）
  decisions.py     决定线索
  ontology.py      个人实体/关系/状态投影
  audit.py         个人写操作审计（可并入 Ametrine audit）
  retrieval.py     个人原话检索（词法 + 向量 + RRF）
  schemas.py       Pydantic DTO
  service.py       对外用例：append/survey/recall/context
  router.py        /api/personal/*
  skills.py        Skillshelf 适配器（不复制 skill 代码）
```

### 4.3 删除的 Isla 基础设施

不迁：

- `truth/ledger.jsonl` 文件账本、`.idx` 侧车、`read_rows` 缓存、字节 offset、`fcntl` 文件锁。
- `ingest.py` 的 offset/全量回退/投影增量；改由 Postgres 事务 + 读模型。
- 自写 `jobs` 表/worker；改 `arq` + Redis（Ametrine 已有 Redis）。
- `sqlite-vec`、FTS5；改 Milvus（文档/个人向量）+ Postgres `pg_trgm`（个人原话词法）。
- 自写 OpenAI HTTP/SSE 客户端；改官方 `openai` SDK + 薄 reasoning 过滤。
- Isla 侧栏、主题、页面组件、chatStore；只保留交互与文案作为参考。
- `house/library` 与 `library.py`；迁到 Skillshelf。

## 5. 数据模型

### 5.1 个人账本

```sql
personal_ledger (
  seq           bigint primary key,
  id            text unique not null,          -- ev-000001
  prev          char(64) not null,
  hash          char(64) not null,
  occurred_at   timestamptz not null,
  recorded_at   timestamptz not null,
  actor         text not null,
  source        text not null,
  kind          text not null,
  text          text not null,
  valid_from    timestamptz not null,
  valid_until   timestamptz,
  provenance    jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
```

规则：

- 只 `INSERT`，不 `UPDATE`/`DELETE`；更正靠追加 `retract`/`expiry`/`label` 行。
- `seq` 连续；`prev` 指向上一条 `hash`；`hash = sha256(canonical(row))`。
- 追加在同一事务里：锁 `personal_ledger` 的 advisory lock，读尾，校验，插入。
- 提供 `GET /api/personal/ledger/export`，导出 JSONL；导出是审计格式，不是主存。
- 启动/夜间跑 `verify`；不通过拒绝写入，明确报错。

### 5.2 个人事件读模型

`personal_event` 可以是物化视图或同步表：

- 过滤 `kind in (ask, answer, reply, pref)`，排除 `retract/expiry/day/diary/label`。
- 把 `retract` 目标标为 `retracted`；`expiry` 目标写 `valid_until`。
- 提供 `speech`/`work` 判定所需字段：`source`、`actor`、`provenance.sitting`、`text`。
- 词法索引：`pg_trgm` GIN on `text`；个人检索用 `ILIKE %q%` + similarity + 向量 RRF。
- 向量：Milvus collection `personal_event`，字段 `event_id, embedding, actor, kind, occurred_at`；embedding 维度按当前模型。

### 5.3 记忆与派生

```sql
personal_memory_trace (
  event_id   text primary key references personal_ledger(id),
  phase      text not null,          -- barred/labile/stable/dormant/retired
  strength   real not null,
  holds      boolean not null,
  reasons    jsonb not null,
  age_days   int,
  computed_at timestamptz not null default now()
);
```

- 可全量重算；不是真相。
- `personal_alias`、`personal_decision`、`personal_ontology_entity/relation/state` 同理。
- `personal_period` 优先用 SQL 视图（按 `occurred_at` 分组）；不物化目录。
- `personal_chat_link`：`conversation_id`/`message_id` ↔ `event_id`，让 UI 消息可点回原话；会话正文不是第二真相。

### 5.4 与 Ametrine 现有表的关系

- `conversation`/`message`：保留，作为 UI 会话与流式状态；Isla 的回答额外落 `message.meta.personal = {event_ids, brief}`。
- `document`/`document_chunk`：保留；文档引用用 `passage:*`，个人原话引用用 `ev-*`，两种引用不混。
- `user.preferences`：保留；个人设置写这里，不另建 settings 表。
- `MemoryItem`：删除或标记 deprecated；不要让它和 `personal_memory_trace` 形成第二套记忆。

## 6. API 契约

个人模块统一前缀 `/api/personal`：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/ledger` | 追加一条原话/机器留痕 |
| GET | `/ledger` | 按条件列原话 |
| GET | `/ledger/verify` | 校验 hash chain |
| GET | `/ledger/export` | 导出 JSONL |
| GET | `/memory` | 记忆 survey（counts/items/meter） |
| POST | `/memory/recall` | 给定一句话，返回召回的原话与理由 |
| GET | `/resolve` | 指代解析 |
| GET | `/periods` | 周期列表 |
| GET | `/periods/{level}/{key}` | 周期详情 |
| GET | `/decisions` | 决定线索 |
| GET | `/ontology` | 个人实体/关系摘要 |
| GET | `/search` | 个人原话检索（词法+向量） |

聊天：

- `POST /api/chat` 不增加 `assistant` 字段；personal 租户自动带个人 context，knowledge 租户自动带文档 context。
- SSE 事件沿用 Ametrine：`token`、`reference`、`done`、`error`。
- `reference` 同时支持 `{type: "event", id: "ev-..."}` 与 `{type: "passage", id: "..."}`。
- 写操作仍走独立 action endpoint，不在聊天里直接执行。

## 7. 前端

### 7.1 路由

```text
/                     personal -> /personal/chat; knowledge -> /chat
/chat                 B 端知识库对话
/personal/chat        Isla 对话（系统默认入口）
/personal/memory      记忆
/personal/search      个人原话检索
/personal/resolve     指代
/personal/decisions   决定
/personal/periods     卷
/personal/people      人（旧 house 只读，可后置）
/personal/rooms       房间（旧 house 只读，可后置）
/personal/preferences 偏好
/settings             账号、模型、配额、租户（合并 Isla 设置）
```

- 全部用 Ametrine 的 AppLayout、AuthScreen、ThemeProvider、i18n、Toast、Dialog、Table、PageSkeleton。
- 不迁 Isla 的侧栏/颜色/字体；页面内容可以照搬文案与交互。
- `/personal/chat` 复用 Ametrine 的 SSE/消息组件，替换 prompt 组装与引用渲染。
- 书房入口改为外链/嵌入式 Skillshelf；不在 Ametrine 内实现 skill 浏览。

### 7.2 入口与导航

- `tenant.mode = personal` 时，登录后落在 `/personal/chat`，导航显示：对话、记忆、检索、指代、决定、卷、偏好、文档、设置。
- `tenant.mode = knowledge` 时，保持现有 Dashboard/知识库/管理台导航，额外显示「个人」入口（如果用户有权限）。
- 同一个用户可以在两个 mode 的租户里，不共享个人账本；账本按 `tenant_id + user_id` 隔离。

## 8. 技能库：Skillshelf

### 8.1 目标

- 新仓：`~/Code/Skillshelf`（名字可改）。
- 独立 git 仓、独立版本、独立测试；不被 Ametrine/Isla import。
- 数据：`skills/`（从 `house/library/skills` 复制，去掉 `.DS_Store`）。
- 能力：list / search / quote / outline；先文件系统，后 HTTP/MCP。

### 8.2 接口

第一阶段：

```bash
skillshelf list
skillshelf search "帮我写一篇公众号" --limit 3
skillshelf quote gzh-writer "帮我写一篇公众号"
```

第二阶段：

```http
GET /skills
GET /skills/search?q=...
GET /skills/{slug}
GET /skills/{slug}/quote?q=...
```

Ametrine 只通过 `src/personal/skills.py` 调 HTTP；失败时明确说「技能库没连上」，不把 skill 当记忆。

### 8.3 解耦规则

- 不在 Ametrine 里复制 `library.py` 或 skill 文本。
- 不在 Isla 里保留第二份 skill 数据；迁移完成后删除 `house/library` 与 `LibraryPage`。
- Skillshelf 不依赖 Ametrine 的数据库、账号、模型；只依赖文件系统。
- 以后可以用 MCP/组合方式接入，不绑定 HTTP。

## 9. 推理与检索

### 9.1 推理提供方

Ametrine 现有 `inference_role_binding` 绑定 Xinference。C 端不能要求每个用户跑 Xinference。

新增抽象：

```text
InferenceProvider
  ├── XinferenceProvider    B 端自托管
  └── OpenAICompatProvider  C 端任意 OpenAI 兼容端点（GLM/OpenAI/…）
```

- 复用 Isla 的 `endpoint.py` 配置形状：`base_url/model/key/headers/models_path/chat_path/timeout/max_tokens`。
- 官方 `openai` SDK；不再自写 HTTP/SSE。
- reasoning 过滤保留为薄适配（`reasoning_content`/`thinking`/`<think>`）。
- B 端继续用 Xinference；C 端默认 OpenAI 兼容；同一 `llm` 服务接口。

### 9.2 检索

- 文档：Ametrine Milvus 稠密 + rerank。
- 个人原话：Postgres `pg_trgm` 词法 + Milvus `personal_event` 向量 + RRF。
- 引用：文档 `passage:*`，个人 `ev-*`；回答里必须可点开。
- 不做第二套向量库；Milvus 是索引，Postgres 是事实。

## 10. 迁移阶段

### P0：准备（0.5 天）

- Ametrine 工作区 clean，push 完成（已做）。
- 建分支 `personal`。
- 建 `~/Code/Skillshelf`，复制 skills，先把仓库跑起来。
- 冻结 Isla 新功能；当前 `0562d6a` 作为回滚点。

### P1：垂直切片（2–3 天）

- `personal_ledger` 表 + 迁移脚本；导入 Isla 307 行。
- `GET /api/personal/memory` 返回与 Isla `survey` 相同的 counts/holding/meter。
- `POST /api/chat` personal 模式：用 Isla context + Ametrine SSE 回一条带 `ev-*` 引用的回答。
- 验收：307 行 hash chain 校验通过；memory counts 与 Isla 一致；引用可点开。

### P2：Personal 领域（1.5–2 周）

- 移植 `memory.py`、`context.py`、`resolve.py`、`periods.py`、`decisions.py`、`ontology.py`。
- 重写为 async SQLAlchemy + Postgres；不搬文件账本/offset/lock。
- 词法检索 + 向量 + RRF。
- 新 pytest：账本、记忆门、撤回/失效、指代 gold、周期、决定、引用校验。
- 验收：关键行为不变量通过；10k 原话 context < 1s；memory survey < 500ms。

### P3：前端（1 周）

- Ametrine 壳子里加 `/personal/*` 页面。
- 入口、导航、租户 mode。
- 文档页复用；书房外链 Skillshelf。
- 验收：personal 登录落 `/personal/chat`；knowledge 租户行为不变；移动端可读。

### P4：整合与切换（1 周）

- 文档 + 个人原话双 scope 检索；引用类型统一。
- 配额：personal 也走 token quota。
- 数据迁移：账本、会话（可选）、偏好、设置；旧 `data/` 只读保留。
- 灰度：同一台机 personal 租户先用；B 端回归。
- 验收：B 端 RAG 回归通过；C 端完整走通；旧 Isla 可回滚。

### P5：收口（3 天）

- 删 Isla 废弃代码/数据；更新 README/运维；性能与安全回归。
- 版本号、迁移脚本、doctor 检查。

总计：**4–5 周**（不含 Skillshelf 独立开发）。

## 11. 测试策略

- 新后端测试放 `apps/backend/tests/`，pytest + pytest-asyncio + 测试 Postgres（独立 schema/database，事务回滚）。
- 不追求数量；先列不变量：
  1. 账本只增、hash chain 通过、撤回/失效不改旧行。
  2. 记忆门：work/life/pref/diary/retract/expiry 的 phase/strength/holds 与 Isla 一致。
  3. 引用：回答不能引用未提供的 `ev-*`；伪造引用被重写或拒发。
  4. 指代：gold 集仍 10/10；未注册词拒绝而不是猜。
  5. 周期：计数与 Isla 一致；详情目录与 events 一致。
  6. 双 scope：文档引用与个人引用不混。
  7. B 端回归：现有 RAG 上传/检索/引用/配额不受影响。
- 前端：personal 路由、入口、引用点击、三态、移动端。
- 性能门：307 行导入 < 2s；10k 原话 context < 1s；memory survey < 500ms；文档检索回归不超过现有基线 20%。

## 12. 风险与取舍

| 风险 | 影响 | 处理 |
|---|---|---|
| Ametrine 后端 0 pytest | 迁移后回归无网 | 先建 personal 测试；B 端加 smoke；不把“能跑”当稳 |
| Milvus/Xinference 运维重 | C 端部署成本高 | C 端默认 OpenAI 兼容 + 只跑 Postgres/Redis/Milvus；Xinference 仅 B 端 |
| 双真相：ledger vs message | 数据不一致 | ledger 是真相；message 只存 UI 会话，`meta.event_ids` 关联 |
| 文档 vs 个人记忆混淆 | 隐私/错误记忆 | 文档默认不进 personal memory；只有人保留的原话才进 |
| 前端重写 | 工期 | 用 Ametrine 壳子，只搬页面内容；1 周量级 |
| 技能库耦合 | 再次变成地基 | 独立仓 + HTTP/MCP；不在 Ametrine 复制代码 |
| 账本迁移 | 丢行/断链 | 导入后全链 verify；旧 `data/` 只读保留；灰度 |
| 租户隔离 | 个人数据串租户 | 所有 personal 表带 `tenant_id`/`user_id`；RLS 或 service 强制过滤 |
| 注释/文档膨胀 | 再次“文档=进度” | 代码只写 why；文档只留这一份升级方案与运维说明 |

## 13. 明确不做

- 不做 C/B 两套后端、两套账号、两套文档库。
- 不迁 Isla 的 UI 组件与视觉。
- 不迁文件账本/index/offset/文件锁/sqlite-vec/FTS5/自写 jobs。
- 不在 Ametrine 内实现 skill 浏览/执行；Skillshelf 独立。
- 不在本轮做 Thought 图谱、个人 claim、计费、复杂多租户运营。
- 不用模型直接写记忆/账本；模型只产判断，代码裁决。

## 14. 第一周任务清单

1. 建 `personal` 分支；建 `~/Code/Skillshelf` 并跑通 list/search。
2. `personal_ledger` 表 + Alembic 迁移 + 307 行导入脚本。
3. `personal.memory` 最小服务：survey counts/holding/meter。
4. `/api/personal/memory` + `/api/chat` 自动个人 context 的垂直切片。
5. 一条真实问题的回答：带 `ev-*` 引用，引用可点开。
6. 记录切片数据：导入耗时、survey 耗时、chat 首 token/总耗时。
7. 切片通过后，再开 P2；不通过就停，不硬推。

## 15. 执行记录

### 2026-11-22 P1 垂直切片（分支 `personal`）

已落：

- `Tenant.mode`；迁移 `d1a7c3e9f2b4`；`default_assistant` 已由 `e7c5b2a9d431` 删除。
- `personal_ledger`（append-only、每租户一条链、payload 保存原始行）。
- `src/personal/`：canonical、memory、service、DTO、`/api/personal/*`。
- 导入脚本：`scripts/import_personal_ledger.py`；自检：`scripts/selfcheck_personal.py`。
- 旧账本 307 行 + 54 条 legacy label 导入本地 Postgres；`ledger_ok`，361 行。
- 记忆 survey 与 Isla 同口径：`barred 293 / labile 7 / stable 0 / dormant 7 / retired 0`，holding 7。
- API 实测：`/api/personal/memory`、`/ledger`、`/ledger/verify`、`/ledger` 追加、`/ledger/export`、重复导入拒绝。
- 前端新增 `/personal` 记忆页与 `personalOnly` 导航；`knowledge` 租户不显示该入口，B 端界面不变。
- `/api/current` 增加 `tenant_mode`；136 个前端测试通过。

已落（P2 第一刀）：

- 删除 `Tenant.default_assistant`（`e7c5b2a9d431`）；`/api/chat` 不设 `assistant` 参数，Isla 是系统身份。
- personal 租户自动注入个人 context；knowledge 租户不注入；两边共用同一个 `/api/chat`。
- 流式/非流式助手消息的 `meta` 记录 `personal_event_ids`，供引用回溯。
- 个人原话检索：`GET /api/personal/search`，Postgres `pg_trgm` GIN 索引（`f2b8c6d0e514`）。
- 个人周期：`GET /api/personal/periods?level=week|month|quarter|year` 与详情；周键按 ISO 周。
- 个人页加入检索框与最近 8 周计数；账本列表默认隐藏 label/retract/expiry/day/diary/pref。
- 别名：`GET /api/personal/aliases`，从「叫我/我是老二/我们是 A/B/C」里抽，不写死。
- 指代：`POST /api/personal/resolve`，只解析账本登记过的日期、上次、人物与群体；没依据明确拒绝。
- 个人页加入「指代」面板；说话人名字本身也作为可解析词（比旧实现多一步）。
- 本体：`GET /api/personal/ontology`，从 speech 行现算 actor/channel/session/date/kind/term 与 mentions；不写第二份图文件。
- 个人页加入本体摘要（实体/关系/状态/原话计数与实体标签）。

未落（P2/P3）：

- 个人引用在聊天 UI 的可点击渲染；ontology 的持久化/缓存（当前按请求现算）。
- 个人前端路由与导航；文档 + 个人双 scope 检索。
- 周期/指代/决定/ ontology 的 async 移植。

## 16. 暂缓：Chat / 推理（2026-11-22）

Ametrine 是本地优先；当前没有接远端 API，这台机器也带不动 LLM / embedding / rerank。Chat 相关模块先冻结，不拿假数据或空壳接口充数。

暂缓范围：

- `/api/chat` 的生成、RAG 回答、SSE 的端到端验收。
- LLM / embedding / rerank 的加载、绑定、tokenizer、推理性能。
- 聊天页的个人引用可点击渲染、对话中的 `ev-*` 回溯。
- 依赖 embedding 的文档入库/向量检索（解析与 pg_trgm 检索仍可用）。

已经落但不依赖模型：

- `/api/chat` 的个人 context 自动组装；`knowledge` 租户不注入。已用依赖替换验证 prompt，未做真实生成。
- 账本、记忆门、原话检索（pg_trgm）、周期、决定线索、留下/保留。

恢复条件：本机有可用模型运行时，或接上远端 OpenAI 兼容端点。恢复时直接接现有 `/api/chat`，不新增 `assistant` 参数，不做第二套对话栈。
