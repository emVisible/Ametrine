<div align="center">

<img src="apps/frontend/public/favicon.png" alt="Ametrine" width="96" height="96" />

# Ametrine

> 一套自托管的 RAG 工作空间：文档是你的，模型是你的，数据库也是你的，中间没有别人。

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12-blue)
![Runtime](https://img.shields.io/badge/runtime-self--hosted-blue)

[English](README.md) · **简体中文**

Ametrine 是一个本地优先的知识库系统，核心是检索增强生成（RAG）。它接收真实文档、按语义切分、
向量化进 Milvus，然后带着来源文档、分块编号与相关性分数一起给出答案。多租户、知识库级权限、Token 配额与分块级治理
是产品的一部分，不是外挂的补丁。

</div>

---

## 特性

| 方向 | 提供什么 |
| --- | --- |
| 检索 | 稠密向量检索 + 可选重排（cross-encoder）、请求级 `top_k`、相关性阈值，以及**命中测试面板**：不调用大模型就能看到这次到底召回了什么 |
| 治理 | 单个分块可**停用 / 改写（重新向量化）/ 删除**，整篇一键切换，计数实时算出 —— 切分不理想时不必重传整个文件 |
| 溯源 | 引用随消息一起落库（`message.meta`），刷新、清缓存、换设备之后答案仍然可核对 |
| 多租户 | 每个租户对应一个知识库（一个 Milvus database），成员按库获得读 / 写 / 管理授权 |
| 配额 | 按日、按月 Token 预算，由已存消息推算，在模型入口处拦截并返回 `429`；填 `0` 即无限制 |
| 对话 | SSE 流式在切换会话时不被打断、会话延迟创建、中英双语界面、日夜主题、浏览器语音输入 |

## 结构

```
apps/
├── frontend/   React 19 · Vite · Tailwind v4 · Zustand · TanStack Query · React Router 7
├── backend/    FastAPI · SQLAlchemy 2（异步）· LangChain 解析器 · pymilvus
├── inference/  独立的 Xinference 环境（不含 vLLM，因此 torch 不被钉死）
└── database/   Docker Compose：PostgreSQL 16 + pgvector、Redis 7、Milvus 2.5、etcd、MinIO
```

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| 前端 | `8000` | Vite 开发服务器，`/api` 代理到后端 |
| 后端 | `3000` | 接口文档在 `/docs`；健康检查是根路径 `GET /health`，**不是** `/api/health` |
| Xinference | `9997` | LLM · Embedding · Rerank 模型 |
| PostgreSQL | `5432` | 关系、文档、分块、消息、授权 |
| Milvus | `19530` | 向量；每个租户一个 Milvus database |
| Milvus UI | `9091` | 可选，排查用 |
| Redis | `6379` | 流式与历史之间短暂存放引用的缓存 |

PostgreSQL 存正文与事实，Milvus 存向量。检索返回的是 `(doc_id, chunk_id)`，正文再从 PostgreSQL
取回 —— 所以「让某个分块不参与检索」不需要动向量库的 schema，也不需要重建集合。

## 环境要求

- Ubuntu 20.04+（日常开发在 WSL2 内）
- Python 3.11 – 3.12 与 [uv](https://docs.astral.sh/uv/)
- Node.js ≥ 20（`dev.sh` 用 `fnm` 固定到 25）+ `pnpm`
- Docker Compose（数据层）
- 显卡可选。约 10 GB 显存即可跑开发组合：一个小参数指令模型 + `bge-m3` + `bge-reranker-base`。
  不主动执行脚本就不会下载任何东西。

## 快速开始

```bash
git clone https://github.com/emVisible/Ametrine.git
cd Ametrine

# 1. 数据层 —— PostgreSQL、Redis、Milvus
docker compose -f apps/database/docker-compose.yml up -d

# 2. 配置 —— 复制模板再填写（模板填出来的文件不要提交）
cp apps/backend/.env.example  apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
#    至少改掉这三处，否则后端会拒绝启动或启动后无可用目录：
#    SECRET_KEY（模板里给了生成命令）、POSTGRE_ADDR 的口令、DOC_ADDR（建议绝对路径）

# 3. 应用环境
cd apps/backend && uv sync && cd ../..

# 4. 建库 —— 这一步**不能**用 `alembic upgrade head`
#    最早的迁移只有 ALTER，它改的 `user` 表得先存在，所以没有任何一条迁移能建出第一张表；
#    而 lifespan 的 create_all 既不写 alembic_version，也不播种 `role` 表 ——
#    `role` 是 `user.role_id` 的外键目标，空表时「注册第一个账号」只会撞到外键违反。
#    init_db.py 把这三件事一次做完：按模型建表、播种 user/manager/admin、stamp 到 head。幂等。
apps/backend/.venv/bin/python scripts/init_db.py --create-database

# 5. 第一个管理员 —— 自助注册拿不到 admin（服务层把 role_id 写死成 1），
#    没有它 /admin/* 与「模型推理」页永远是 403，新系统一打开就是锁死的。
apps/backend/.venv/bin/python scripts/create_admin.py --name <你的账号>

# 6. 体检（只读，什么都不改）。它逐扩展名报告这套部署能不能解析、
#    外部服务连不连得上、依赖声明与 uv.lock 是否一致、哪些东西是「注册表说在跑但实际打不通」。
apps/backend/.venv/bin/python scripts/doctor.py          # 快
apps/backend/.venv/bin/python scripts/doctor.py --live   # 再真的调一次 embedding / rerank / 生成

# 7. 推理环境（可跳过：一个模型都没加载，应用照样起）
bash scripts/setup_inference_env.sh

# 8. 其余服务 —— 前端、Xinference、后端，一个 tmux 会话。它只负责**把服务起起来**
./dev.sh

# 9. 跑哪些模型现在是应用内的一个设置：
#    管理台 → 模型推理（http://localhost:8000/admin/inference）
#    加载、卸载、换绑定、决定哪些随服务器启动，都在那里做。
#    `scripts/load_models.sh` 保留为**一次性**播种（按 .env 里那三个旧 id）。
```

访问 <http://localhost:8000>，交互式接口文档在 <http://localhost:3000/docs>。

生产部署前端不要跑 vite dev server：`cd apps/frontend && pnpm build`，
产物在 `apps/frontend/dist/`，仓库自带的 `apps/frontend/deploy/nginx.conf` 就是给这一步用的
（`/api` 反代到后端，SPA 回落到 `index.html`）。

## 配置项

`apps/backend/.env` 不进版本库，所有键在 `.env.example` 里都有说明。最要紧的几个：

| 键 | 含义 |
| --- | --- |
| `SECRET_KEY` | JWT 签名密钥。每个部署都要新生成一个；一旦它被共享或提交，token 就无从验真 |
| `POSTGRE_ADDR` | 异步 SQLAlchemy 连接串（`postgresql+asyncpg://user:pass@host:5432/ametrine`） |
| `MILVUS_HOST` / `MILVUS_PORT` / `MILVUS_METRIC_TYPE` | 向量库目标。选 `L2` 时距离越小越相似 |
| `XINFERENCE_MAIN_ADDR` | 推理服务地址 |
| `XINFERENCE_ADMIN_USER` / `XINFERENCE_ADMIN_PASSWORD` | 后端拿去换 Xinference JWT 的凭据（`src/inference/auth.py`，401 会自动重签一次）。xinference 3.x **默认就开鉴权**，不配这两个键应用就完全无法推理 —— 而 `/health` 只探 postgres/redis/milvus，看不出这件事 |
| `XINFERENCE_API_KEY` | 可选，旧写法。API key 的 scope 只有 models:read / models:list，**连 launch 都做不了**（实测 403），而 JWT 两边都覆盖，所以它不再是必需项 |
| `XINFERENCE_{LLM,EMBEDDING,RERANK}_MODEL_ID` | **已降级为第一次的种子（deprecated，再用一个版本）**。「用哪个模型答题」存在 `inference_role_binding` 表里、在管理台改；这三个值只在表还是空的时候用来播种 |
| `K` / `P` / `MIN_RELEVANCE_SCORE` | 候选条数、最终进入上下文条数、重排相关性下限 |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` / `SEMANTIC_SPLITTER` | 入库切分。`CHUNK_SIZE` 是**硬上限**（两条路径都成立）；`SEMANTIC_SPLITTER=true` 只改变「超过上限的单个段落从哪里切」这一件事，结构正常的文档不会为切头发任何 embedding 请求。已索引的文档保持它被索引时的切分方式 |
| `EMBEDDING_DIMENSION` | 必须与 embedding 模型一致，改动它等于全量重建索引 |
| `DOC_ADDR` | 上传原文的落盘目录。相对值按**仓库根**解析（不是按 cwd），启动时创建并检查可写，做不到就拒绝启动 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` / `REDIS_PASSWORD` | 会话引用、并发闸门与登录失败计数都在 Redis 上。这四个键是新加的 —— 之前连接参数写死在代码里，换端口或加密码都得改源码。默认值就是原来那组 |

## 自检

```bash
cd apps/frontend && pnpm check     # tsc -b + eslint --max-warnings=0 + 131 个单元测试
# 迁移现在只认 .env 的 POSTGRE_ADDR（alembic.ini 里那条写死的 url 已清空）：
cd apps/backend && .venv/bin/alembic current && .venv/bin/alembic upgrade head
# 全新空库请走 scripts/init_db.py（见「快速开始」第 4 步），不要直接 upgrade head

# 部署体检（只读）：解析能力 / 外部服务 / 依赖与 lock 一致性 / 推理活性
apps/backend/.venv/bin/python scripts/doctor.py --live

# 推理装配的进程内自检（除了数据库，不需要别的服务在跑）：
apps/backend/.venv/bin/python scripts/selfcheck_inference.py
# 知识库侧的进程内自检（全是桩件，不动真数据）：
apps/backend/.venv/bin/python scripts/selfcheck_knowledge_base.py
# 分块器的进程内自检（`chunk_size` 是硬上限、结构正常的文档不发 embedding）：
apps/backend/.venv/bin/python scripts/selfcheck_splitter.py
# 上传中断清理的进程内自检（假上传在第二次 read() 时抛 CancelledError）：
apps/backend/.venv/bin/python scripts/selfcheck_upload_cancel.py
# 推理管理面对着「真在跑的后端 + xinference」打一遍：建一个一次性管理员、
# 写一次绑定、还原、删号（删号在 finally 里，中途崩了也不留残留账号）：
apps/backend/.venv/bin/python scripts/gate_inference_http.py
```

前端那道门是 `pnpm check`（内部跑 `tsc -b`），**不是** `npx tsc --noEmit`：
`apps/frontend/tsconfig.json` 是 solution 式的，在那个根目录上 `--noEmit` 一个文件都不查还退出 0。
每个文案键都是编译期校验的路径类型（`MsgKey`），漏翻会在编译期红，而不是把裸键显示给人看。

## 权限模型

- 请求由签名 JWT 鉴权；角色为「用户 / 经理 / 管理员」。
- 知识库的每一次读写都按调用者的授权判定 —— 而且判断发生在碰向量库和模型之前，
  所以越权请求拿到的是 `403`，不是某个无关依赖抛出的堆栈。
- 跨租户访问是逐路由拒绝的，不是靠界面藏起来：列文档、开文档、读分块都会先定位归属库。
- 管理员专属字段（角色、Token 限额）不能自助修改。
- Token 用量由已落库的助手消息推算，清浏览器缓存绕不过限额；而且每条生成入口都被拦，
  不存在「换个接口继续烧」。
- 登录失败时「用户不存在」与「密码错误」返回**完全相同**的响应体，并按 IP+账号计数限流，
  所以这个端点不是账号枚举的探针。
- 上传有大小上限，且只接受解析器真正认识的扩展名；解析或索引失败时，客户端只看到异常**类型**，
  完整堆栈留在服务端日志里。

## 部署边界

`apps/database/docker-compose.yml` 描述的是**单机开发拓扑**，超出这个范围它默认并不安全：
Postgres、Redis、Milvus 的端口都发布在所有网卡上，Redis 与 Milvus 完全不带认证，
文件里的示例口令（`preview`、`minioadmin`）就是当前生效的口令。任何能连上 `19530` 的人
都可以直接读改删所有租户的向量，而不经过这套 API —— 上面的角色与授权模型只管走接口的流量。

在这套拓扑服务第二台机器、或接入任何网络之前，必须：

1. 把所有发布的端口收回回环（`127.0.0.1:5432:5432`），并且不要把 Milvus 的 `9091` 管理端口发布出去；
2. 给 Redis（`requirepass`）、Milvus（`authorizationEnabled`）、MinIO（改掉默认口令）打开认证，
   并换一条值得保留的 Postgres 口令；
3. `SECRET_KEY` 必须够强 —— 过短、仍是占位值、或字符种类太少的密钥，后端会直接拒绝启动；
4. `CORS_ORIGINS` 只写真正该放行的浏览器来源。这里刻意不接受通配符：接口发的是 Bearer token，
   而前端把它存在浏览器存储里；
5. Redis 现在从 `.env` 读 `REDIS_HOST/PORT/DB/PASSWORD` —— 加了 `requirepass` 就把它填上，
   多个部署共用一个实例时用 `REDIS_DB` 隔开命名空间。

向量库的版本也不能将就：`2.5.27` 之前的 Milvus 按设计就会在管理端口上响应未认证请求，
所以要把镜像版本钉住，而不是指望本机防火墙。

上面这些不是「建议」而是能一次查清的事实，所以有 `scripts/doctor.py`：它只读，
逐扩展名报告这套部署能不能解析（`.pdf`/`.doc`/`.epub` 缺依赖就是会 501）、
依赖声明与 `uv.lock` 是否一致、外部服务连不连得上、以及绑定的模型是不是真的能出东西。
`--live` 那一条值得在部署完成后跑一次：这一轮撞到过 CUDA sticky device-side assert，
`/v1/models` 与 `/api/inference/overview` 都显示模型在跑，而 48/57 次请求全回空回答 ——
**「注册表可读」从来不等于「模型可用」**。

同一个判断也进了应用本身：管理台「模型推理」页的**活性探测**面板
（`POST /api/inference/liveness`）会按当前绑定真的打一次 llm / embedding / rerank，
并按角色说清「可用」的依据是什么（正文非空、向量维度对得上、重排有结果）。
它刻意不并进 `/health` —— 那条是启动脚本每隔几秒打一次的，就绪探针不该变成负载源。

## 已知限制

- 服务端的生成过程是请求作用域的。在应用里切会话不会打断输出，关掉标签页会。
- 检索只有稠密向量。BM25 / 稀疏向量 + RRF 融合检索需要在既有 Milvus 集合上加标量字段，
  等于全量重建索引。
- Agent 与工具调用已有数据表和流式事件位，但当前分支还没有随仓库发布任何 agent 运行时。
- 语音输入走浏览器的 Web Speech API，因此依赖浏览器支持，并且会经过浏览器厂商的语音服务。

## 参与

版本与变更记录见 [`CHANGELOG.md`](CHANGELOG.md)；版本号只有一个来源
（`apps/backend/src/version.py`），`scripts/doctor.py` 会检查它与 `pyproject.toml`、
`uv.lock`、`package.json` 和最新 tag 是否一致。

欢迎 issue 与 PR。如果你发现的是正确性问题 —— 尤其那种「让错误答案看起来很对」的 ——
请先开 issue，这类问题优先级最高。

## 许可证

以 [Apache License 2.0](LICENSE) 发布。该文件是官方原文，只填了版权行：
`Copyright 2026 emVisible`。

## 致谢

基于 FastAPI、LangChain、Milvus、Xinference、PostgreSQL 与 React 构建。

*致我们终将逝去的青春。* 🌙
