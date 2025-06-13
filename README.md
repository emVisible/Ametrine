## 简介

Ametrine——基于 RAG 的本地知识库系统

后端：FastAPI + LangChain + Xinference + Milvus + PostgreSQL, 基于 uv 进行包管理

特性

- 基于 Milvus 的多租户模式（租户与数据库一一绑定）
- 传统+向量数据库（Milvus + PostgreSQL）
- 支持 Rerank Model
- 文档预处理：语义切分（Semantic） + 常用文件格式解析（Unstructured）
- 文档回溯
- SSE 流式渲染
- Agent：支持 Playwright、Wikipedia、DuckDuckGo、Shell
- 前端：多 Session 历史对话记录 & 自动滚动 & 日夜主题切换 & 配套后台

## 系统要求

最低配置
OS: Ubuntu 20.04
GPU: 没有也行 | 能跑就行
Disk: 30G
Memory: 16G

推荐配置
OS: Ubuntu 20.04
GPU: 2080ti 22G | 3090 | ...
Disk: 60G+
Memory: 32G+

本项目开发使用 3080 或 2080ti，开发模式下所需最低显存约为 10G, 测试部署使用 3090x2

Models
对于常规开发模式，一张 10G 显存的卡可够用, 以 3080 和 2080ti 为例

- LLM
  - qwen3 1.7B (dev) 显存占用 5.2G
- Embedding
  - bge-m3 显存占用 2.4G
- Rerank
  - bge-reranker-base(dev) 显存占用 1.3G
  - minicpm-reranker(product) 显存占用 12G
- Audio
  - SenseVoiceSmall (STT) 显存占用 1.2G
- Image
  - GOT-OCR2_0 (OCR Model) 显存占用 3G

## 依赖安装

概要

- 安装 nvm; 安装 yarn
- 安装 python3.10 (项目开发所使用的版本); isort, black-formatter 等 Python 相关插件
- 安装 postgreSQL 并创建对应数据库

### 前端

进入 apps/frontend

```
yarn
```

### 后端

进入 apps/backend
推荐使用 uv 安装

```
uv pip install
```

### 数据库

#### PostgreSQL

ubuntu 下安装 PostgreSQL

```
sudo apt update
sudo apt install postgresql postgresql-contrib
```

验证安装成功

```
sudo -u postgres psql -c "SELECT version();"
```

安装后会自动创建一个名为 postgres 的系统用户, 切换至该账户

```
sudo -i -u postgres
```

进入交互, 修改密码

```
psql
\password postgres
```

创建对应的数据库

```
sudo -u postgres createdb ametrine
// 或者用SQL
CREATE DATABASE ametrine OWNER postgres
```

Vscode 安装插件：Database Client, 可连接到 postgre 上进行可视化管理

至此, 后端与 Postgre 的连接可以在 apps/backend/base/database 填入并应正常连接(pip 安装了 psycopg2-binary 的前提下)

#### Redis

```
sudo apt install redis
```

## 项目启动

可以前端、Xinference、Milvus、后端这四部分单独启动后, 可运行 dev.sh 一键启动

### 前端

apps/frontend 下进入开发模式

```
yarn dev
```

### Xinference

启动 xinference

启动主节点，用于部署 LLM、Embedding、Rerank 模型（仅开发）
生产模式时，建议 LLM 独占一张 GPU，其余的 Embedding、Rerank、Audio 模型放在另一张 GPU 上

```
uv run -- env xinference-local
```

启动子节点，用于部署 Audio 等模型

```
uv run -- env xinference-local --endpoint 9998
```

### 后端

apps/backend 下运行

两行命令均可, 建议使用原生 uvicorn 命令

```
uv run --env uvicorn main:app --port 3000 --reload
uv run fastapi dev --reload --port 3000
```

### Milvus

apps/database 下
启动 milvus, 基于 Docker

```
bash standalone_embed.sh
```

## 最后

使用中如果遇到什么问题, 欢迎提 issue 或在 discussion 中讨论，项目会长期更进，如果项目对你有什么帮助, 就给个 ⭐️ 吧
致我们终将逝去的青春 🌙
