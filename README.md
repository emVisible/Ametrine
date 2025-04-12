## 简介
本项目为RAG项目, 为Lexinaut的重构版
原始lexinaut:
- emLLM-front (rag分支, 前端)
- emRag (rag分支, 后端)

重构计划
- frontend
  - AntV支持
  - 主题风格
  - 多语言支持
  - 文件上传优化
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

## 项目启动

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

## 系统要求
OS: Ubuntu 20.04
GPU: 2080ti 22G
Disk: 50G+
Memory: 32G+
