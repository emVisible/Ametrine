## 简介
Ametrine-基于RAG的本地知识库
Lexinaut重构版, 正在开发中中⎇
lexinaut:
- emLLM-front (rag分支, 前端)
- emRag (rag分支, 后端)

重构计划
- frontend
  - AntV支持
  - 主题风格
  - 多语言
  - 文件上传
  - 接口重构
- backend
  - 混合检索
  - 多格式document analysis支持
  - Embedding优化
  - split chunk优化
  - overlap 优化
  - Agent
    - 联网搜索
    - Image模型
    - *工具链
  - *SSE -> WS
  - *Oauth2加密
  - * websockets
- database
  - vector
    - Milvus
  - traditional
    - postgre
    - mongo
    - redis
  - 表重构

- deploy
  - docker

Task
- 确认定位
- 提示词管理
- 按时间去重
- 轻量化部署
- 动态与静态模式的切换
- 可视化回答：比如图表
- 第三方API
- 对话数据存储系统，包括聊天记录，问答记录，未解觉问题，错误问题
- 对话的格式_ 答案+来源
- 对话系统-对话框+检索功能，问题固定，固定话术
- 意见反馈系统
- 终端类型
- 政治倾向判断 & 情感问题判断
- 时间概念
- 提示词-对话不同角色
- 统一问答系统
- 问题推荐(热点问题)
- 多知识库-业务知识库，优化知识库
- 多集合查找和单集合查找
- 低代码编排
- 多端

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
apps/backend下
```
xinference-local
uvicorn main:app --port 3000 --reload
```

### 前端
apps/frontend下
```
yarn dev
```

### 数据库
apps/database下
启动milvus, 基于Docker
```
bash run.sh
```