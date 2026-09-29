<img src="apps/frontend/public/logo.svg" alt="Ametrine" width="220" />

> 一套自托管的 RAG 工作空间：文档是你的，模型是你的，数据库也是你的，中间没有别人。

[English](README.md) · **简体中文**

Ametrine 是一个本地优先的知识库系统，核心是检索增强生成（RAG）。它接收真实文档、按语义切分、
向量化进 Milvus，然后带着可点开的引用回答问题。多租户、知识库级权限、Token 配额与分块级治理
是产品的一部分，不是外挂的补丁。

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

# 3. 应用环境
cd apps/backend && uv sync && uv run alembic upgrade head && cd ../..

# 4. 推理环境与模型（可跳过：没有模型应用照样起）
bash scripts/setup_inference_env.sh
bash scripts/load_models.sh apps/backend

# 5. 其余全部 —— 前端、Xinference、后端，一个 tmux 会话
./dev.sh
```

访问 <http://localhost:8000>，交互式接口文档在 <http://localhost:3000/docs>。

## 配置项

`apps/backend/.env` 不进版本库，所有键在 `.env.example` 里都有说明。最要紧的几个：

| 键 | 含义 |
| --- | --- |
| `SECRET_KEY` | JWT 签名密钥。每个部署都要新生成一个；一旦它被共享或提交，token 就无从验真 |
| `POSTGRE_ADDR` | 异步 SQLAlchemy 连接串（`postgresql+asyncpg://user:pass@host:5432/ametrine`） |
| `MILVUS_HOST` / `MILVUS_PORT` / `MILVUS_METRIC_TYPE` | 向量库目标。选 `L2` 时距离越小越相似 |
| `XINFERENCE_MAIN_ADDR` · `XINFERENCE_{LLM,EMBEDDING,RERANK}_MODEL_ID` | 调用哪些模型，按模型 **uid**（不是 model_name） |
| `XINFERENCE_API_KEY` | 服务端未开鉴权就留空；开启后填入签发的 key |
| `K` / `P` / `MIN_RELEVANCE_SCORE` | 候选条数、最终进入上下文条数、重排相关性下限 |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` / `SEMANTIC_SPLITTER` | 入库切分参数；已索引的文档保持它被索引时的切分方式 |
| `EMBEDDING_DIMENSION` | 必须与 embedding 模型一致，改动它等于全量重建索引 |

## 自检

```bash
cd apps/frontend && pnpm check     # 类型检查 + lint + 57 个单元测试
cd apps/backend  && uv run alembic upgrade head
```

## 权限模型

- 请求由签名 JWT 鉴权；角色为「用户 / 经理 / 管理员」。
- 知识库的每一次读写都按调用者的授权判定 —— 而且判断发生在碰向量库和模型之前，
  所以越权请求拿到的是 `403`，不是某个无关依赖抛出的堆栈。
- 跨租户访问是逐路由拒绝的，不是靠界面藏起来：列文档、开文档、读分块都会先定位归属库。
- 管理员专属字段（角色、Token 限额）不能自助修改。
- Token 用量由已落库的助手消息推算，清浏览器缓存绕不过限额。

## 已知限制

- 服务端的生成过程是请求作用域的。在应用里切会话不会打断输出，关掉标签页会。
- 检索只有稠密向量。BM25 / 稀疏向量 + RRF 融合检索需要在既有 Milvus 集合上加标量字段，
  等于全量重建索引。
- Agent 与工具调用已有数据表和流式事件位，但当前分支还没有随仓库发布任何 agent 运行时。
- 语音输入走浏览器的 Web Speech API，因此依赖浏览器支持，并且会经过浏览器厂商的语音服务。

## 参与

欢迎 issue 与 PR。如果你发现的是正确性问题 —— 尤其那种「让错误答案看起来很对」的 ——
请先开 issue，这类问题优先级最高。

## 许可证

以 [Apache License 2.0](LICENSE) 发布。该文件是官方原文，只填了版权行：
`Copyright 2026 emVisible`。

## 致谢

基于 FastAPI、LangChain、Milvus、Xinference、PostgreSQL 与 React 构建。

*致我们终将逝去的青春。* 🌙
