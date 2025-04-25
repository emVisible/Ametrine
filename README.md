## 简介
Ametrine——基于RAG的本地知识库系统, 基于monorepo

## 系统要求
最低配置
OS: Ubuntu 20.04
GPU: 没有也行 | 能跑就行
Disk: 30G
Memory: 16G

推荐配置
OS: Ubuntu 20.04
GPU: 2080ti 22G | 3090 | ...8G以上显存
Disk: 60G+
Memory: 32G+

本项目开发使用3080，开发模式下所需最低显存约为7G, 测试部署使用3090x2

## 依赖安装
概要
- 安装nvm; 安装yarn
- 安装python3.10 (项目开发所使用的版本)
- 安装postgreSQL并创建对应数据库

### 前端
进入apps/frontend
```
yarn
```

### 后端
进入apps/backend
```
pip install -r requirements.txt
```

### 数据库
ubuntu下安装PostgreSQL
```
sudo apt update
sudo apt install postgresql postgresql-contrib
```

验证安装成功
```
sudo -u postgres psql -c "SELECT version();"
```

安装后会自动创建一个名为postgres的系统用户, 切换至该账户
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

Vscode安装插件：Database Client, 可连接到postgre上进行可视化管理

至此, 后端与Postgre的连接可以在apps/backend/base/database填入并应正常连接(pip安装了psycopg2-binary的前提下)

## 项目启动
可以单独启动后, 运行Ametrine/dev.sh一键启动

### LLM
启动xinference
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

常规开发时可按需使用rerank模型

显存占用:
- qwen2.5-instruct 0.5B: 1.4G
- bge-m3: 2.4G
- bge-reranker-base: 1.3G; minicpm-reranker: 12G

### 后端
apps/backend下运行
```
uvicorn main:app --port 3000 --reload
```

### 前端
apps/frontend下运行
```
yarn dev
```

### 数据库
apps/database下
启动milvus, 基于Docker
```
bash standalone_embed.sh
```

## 最后
使用中如果遇到什么问题, 欢迎提issue或在discussion中讨论
如果项目对你有什么帮助, 就给个⭐️吧