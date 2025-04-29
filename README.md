## 简介

Ametrine——基于 RAG 的本地知识库系统, 基于 monorepo

特性

- 多数据库：指的是 Milvus 中的数据库概念；一个数据库绑定多个集合，对应部门的概念
- 多租户：一个租户绑定一个集合，对应部门下公开或私有的的知识库类别
- 集合：一个集合与一个租户绑定(本系统设定), 真正的运行与存储单元

## 系统要求

最低配置
OS: Ubuntu 20.04
GPU: 没有也行 | 能跑就行
Disk: 30G
Memory: 16G

推荐配置
OS: Ubuntu 20.04
GPU: 2080ti 22G | 3090 | ...8G 以上显存
Disk: 60G+
Memory: 32G+

本项目开发使用 3080，开发模式下所需最低显存约为 7G, 测试部署使用 3090x2

## 依赖安装

概要

- 安装 nvm; 安装 yarn
- 安装 python3.10 (项目开发所使用的版本)
- 安装 postgreSQL 并创建对应数据库

### 前端

进入 apps/frontend

```
yarn
```

### 后端

进入 apps/backend

```
pip install -r requirements.txt
```

### 数据库

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

## 项目启动

可以单独启动后, 运行 Ametrine/dev.sh 一键启动

### LLM

启动 xinference

```
XINFERENCE_MODEL_SRC=modelscope xinference-local
```

Models

- LLM
  - qwen2.5-instruct(dev)
  - glm4-chat-1m(prodct) or other llm
- Embedding
  - bge-m3
- Rerank
  - bge-reranker-base(dev)
  - minicpm-reranker(product)

常规开发时可按需使用 rerank 模型

显存占用:

- qwen2.5-instruct 0.5B: 1.4G
- bge-m3: 2.4G
- bge-reranker-base: 1.3G; minicpm-reranker: 12G

### 后端

apps/backend 下运行

```
uvicorn main:app --port 3000 --reload
```

### 前端

apps/frontend 下运行

```
yarn dev
```

### 数据库

apps/database 下
启动 milvus, 基于 Docker

```
bash standalone_embed.sh
```

## 最后

使用中如果遇到什么问题, 欢迎提 issue 或在 discussion 中讨论
如果项目对你有什么帮助, 就给个 ⭐️ 吧
