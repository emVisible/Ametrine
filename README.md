## 简介
Ametrine-基于RAG的本地知识库, 基于monorepo
Lexinaut为旧版本，可以参考我的repo中的
- emLLM-front (rag分支, 前端)
- emRag (rag分支, 后端)

如果项目对你有什么帮助, 或者使用中遇到什么问题, 欢迎联系我或者给我提个Issue

## 重构计划
- frontend
  - 主题风格 & UI (Themes)
  - 多语言 (English & Chinese)
  - 后台：
    - AntV支持
    - document management重构
  - 可视化回答：比如图表
- LLM
  - 对话的格式_ 答案+来源
  - 文档切分策略
    - 新增基于语义切分
    - split chunk优化
    - overlap 优化
  - Agent
    - 联网搜索
    - Image模型
    - *工具链
  - langchain重构
  - Embedding优化
  - 提示词管理
    - 政治倾向判断 & 情感问题判断
    - 时间概念
    - 角色概念

- backend
  - 多格式document analysis支持
  - 静态回答
    - 统一问答系统 (静态)
      - 问题推荐(热点问题)
      - 对话系统-对话框+检索功能，问题固定，固定话术
    - 意见反馈系统 (静态)
  - *SSE -> WS
  - *Oauth2加密
  - *websockets
  - *第三方API

- database
  - vector: Chroma重制为Milvus
    - 混合检索
  - traditional: sqlite重制为postgre, 添加redis & 重构表
  - 按时间去重
  - 对话数据存储系统，包括聊天记录，问答记录，未解觉问题，错误问题
  - 多知识库-业务知识库，优化知识库
  - 多集合查找和单集合查找

- deploy
  - add: docker
  - 轻量化部署
  - 终端类型
  - 低代码编排
  - 多端
  - 确认定位

## 系统要求 (本地开发)
OS: Ubuntu 20.04
GPU: 2080ti 11G；最好是30系的N卡，最低显存10G
Disk: 60G+
Memory: 32G+

## 项目启动
开发模式下所需显存约为7G
本项目开发使用3080 11G版本，测试使用3090

### LLM
启动xinference
```
XINFERENCE_MODEL_SRC=modelscope xinference-local
```
LLM: qwen2.5-instruct(dev) / glm4-chat-1m(prodct)
Embedding: bge-m3
Rerank: bge-reranker-base(dev) / minicpm-reranker(product)
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
OS安装PostgreSQL
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
至此, 后段与Postgre的连接可以填入并应正常连接

apps/database下
启动milvus, 基于Docker
```
bash standalone_embed.sh
```