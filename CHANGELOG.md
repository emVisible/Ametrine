# 更新记录

版本号只有一个来源：`apps/backend/src/version.py` 的 `APP_VERSION`；
`pyproject.toml`、`uv.lock` 里 backend 那条、`apps/frontend/package.json` 与 git tag
必须与它一致（`scripts/doctor.py` 会检查这一点）。
侧边栏那个版本角标也不再写死：它由 `vite.config.ts` 从 `package.json` 注入
`import.meta.env.VITE_APP_VERSION`（此前是源码里的 `"0.1.0"`，发布之后界面还在说上一个版本）。
提交信息是中文的，所以这份记录也是；面向用户的说明在 `README.md`（英文默认）与 `README_zh.md`。

## v0.3.0 — 2026-10-01

这一版的主线不是加功能，而是**让这个系统真的可被部署、可被度量、失败时会说人话**。
前面几轮的成果（对话数据集、跨库检索、推理管理面、应用侧安全）都已合入，
本轮把「看上去能跑」和「在别人机器上能跑」之间的那道沟填了。

### 部署：从「跑不通」到有一条可执行路径

- **空库能建起来了**。此前 `alembic upgrade head` 在空库上必然失败（最早的迁移只有 ALTER，
  它改的表得先存在），而 lifespan 的 `create_all()` 既不写 `alembic_version` 也不播种 `role` 表 ——
  `role` 是 `user.role_id` 的外键目标，所以**空库上注册第一个账号会撞外键违反**，
  报错一个字都不提 `role`。新增 `scripts/init_db.py`（建表 → 播种角色 → stamp head，幂等，
  可选 `--create-database`），A/B 实测过失败与成功两侧。
- **第一个管理员有出路了**。自助注册拿不到 admin（这是对的），但全新部署因此永远进不了
  `/admin/*`。新增 `scripts/create_admin.py`（建号或提权；提权时按应用自己的规则自增
  `token_version`，旧会话当场失效）。
- **迁移与应用不再各连各的库**：`alembic/env.py` 只认 `.env` 的 `POSTGRE_ADDR`，
  `alembic.ini` 里那条写死的开发机 DSN 已清空。
- **Redis 可配置**：新增 `REDIS_HOST/PORT/DB/PASSWORD`（默认值即原硬编码），
  连接失败现在报「该改哪个键」而不是 `Redis connection failed!`。
- **`DOC_ADDR` 不再跟 cwd 跑**：相对值锚到仓库根，启动时创建并检查可写，做不到就拒绝启动。
  顺带删掉一个没有任何代码读取的必需键 `DB_ADDR`。
- `dev.sh` 开头会检查启动链脚本是否齐备，缺就一句说明并退出 —— 不再开一个半死的 tmux 会话。
- 前端 API 前缀收成一处 `src/api/base.ts`，默认值改为**同源相对路径** `/api`：
  原默认 `http://localhost:3000/api` 会被编译进 `dist`，于是「A 机构建、B 机部署」的页面
  只会去打 A 机自己。
- 生产前端有路径了：`pnpm build` + 仓库自带的 `apps/frontend/deploy/nginx.conf`。

### 新增 `scripts/doctor.py`：一条命令回答「这台机器装得起来吗」

只读，什么都不改。逐扩展名报告解析能力（缺 `unstructured[pdf]`、`pandoc`、LibreOffice 就是会 501）、
外部服务连通性、`pyproject.toml` 与 `uv.lock` 的漂移、四处版本号是否一致，
以及 `--live` 下的推理活性探测。它的退出码在有拦路项时非 0。

### 检索质量：量出来了，并且更正了一条错误归因

- 真实多格式语料基准（105 篇 `.md` + 41 篇真实 OOXML/ODF/CSV/PDF/EPUB/EML 等）落盘在 `rag-bench/`，
  `README.md` 是复现与手动测试指南。
- **阈值标定跑通**：金标块的重排分数中位 **0.0397**，而配置是 `0.3` —— 它砍掉 71% 的金标块，
  让 **65%** 的查询变成「一条引用都没有」。`.env.example` 的默认值改为 **0.005**（附完整曲线）。
- **更正**：上一版把「rerank 模式 hit@1 从 0.44 掉到 0.22」归因给重排模型。
  摘掉阈值只比排序，rerank 全面优于纯向量（hit@1 0.5333 vs 0.4667、MRR 0.5635 vs 0.5145）——
  损失 100% 来自那道绝对阈值，模型是净收益。
- **分块器重做**：`CHUNK_SIZE`/`CHUNK_OVERLAP` 现在是硬上限（旧语义路径里它们完全不参与，
  配置写 512 实测切出过 1,409 字的块）；结构正常的文档**一次 embedding 都不发**
  （旧实现对每一句请求一次向量，实测 1,592 字要 10.69 s，整本 EPUB 两次 >900 s 进不了库）；
  语义切分只在超长段落内部使用，且有单元长度上限；embedding 不可用时降级而不是把入库带崩。
  门：`scripts/selfcheck_splitter.py`。

### 失败会说人话

- **生成中断不再对用户表现为「成功的空回答」**：流内带错误事件与错误编号，前端认得它，
  零 token 记为失败。
- **推理活性探测搬进应用**：`POST /api/inference/liveness` + 管理台「模型推理」页一块面板。
  起因是那次 CUDA sticky 事故 —— 48/57 次请求全回空回答，而 `/v1/models`、总览、`/health`
  三处都显示模型在跑。**注册表可读不等于模型可用**，只有真打一次才知道。
- 引用条目现在带 `id`（文档主键）：基准那层的「找回的是不是这篇文档」终于可以不靠文件名猜。
- 删除向量失败时的「可直接重试」改为按**失败原因**决定措辞：向量侧根本没有那个集合时，
  劝人重试是第二次撒谎。
- 上传的库/集合归属错配会得到 409 并说明集合名目前是全局唯一的；
  客户端中断上传不再在盘上留下没有数据库行的孤儿原文。

### 已知限制（本轮没解决，写在明面上）

- 检索只有稠密向量，没有 BM25/稀疏 + RRF 混合；加它要动 Milvus 集合 schema = 全量重建。
- 绑定的模型是 2B 级、单卡显存真实约 11 GB，三模型同机是结构性挤兑。
- `.pdf`/`.doc`/`.ppt`/`.epub`/`.odt` 的解析依赖在这台机器上没装（装它们会牵动 `uv lock` 与 torch）。
- `uv.lock` 里 `unstructured` 不带任何 extras，而 `pyproject.toml` 声明了 9 个 ——
  一次全新 `uv sync` 会把现在能用的解析能力再削掉一半。`doctor.py` 把这条报成红灯。

## v0.2.0 — 2026-09-29

应用侧安全收紧（鉴权面、越权读写、错误外泄、CORS、密钥强度闸门、配额），
对话历史成为可标注的数据集（消息状态、反馈、未解决队列、检索中间态遥测），
多知识库检索（一次 fan-out + RRF）、分块级检索控制、模型管理面（绑定表 + autostart + 凭据自签）。

## v0.1.0 — 2026-09-28

第一个公开版本：FastAPI + Milvus + PostgreSQL + Xinference 的自托管 RAG 应用，
中英双语界面、会话级流式、知识库与租户/成员管理。
