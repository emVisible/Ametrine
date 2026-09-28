# 2026-09-28 白屏根因与后端依赖彻底处理

本轮两件事：把「跳转白屏 / 部署后首屏全白」查到根因并改掉；把 xinference 依赖问题从
「疑似 uv 冲突」查到真正的成因，并落成可执行的拆分方案。所有结论后面都附了实测命令。

---

## 一、白屏：三个独立成因

### A. 跳转时的瞬间白屏 —— `<main key={location.pathname}>` + `anim-page`

`apps/frontend/src/components/AppLayout.tsx:624` 原本是这样：

```jsx
<main key={location.pathname} className="anim-page ...">  <Outlet/>  </main>
```

两件事叠在一起：

1. `key` 随路径变化 → React 认为这是**另一个元素**，每次跳转把整个正文容器卸掉重建；
2. `anim-page` = `animation: fade-rise var(--dur-slow) both`，而 `fade-rise` 的
   `from { opacity: 0 }` → 重建后那一块 260ms 内是**全透明**的，露出来的就是 body 底色
   （浅色主题 `--c-canvas: #f6f7f9`，肉眼就是「白屏一闪」）。

顺带两个副作用：重建会丢掉 `<main>` 的滚动位置；`/admin/vector`、`/admin/vector/:dbId`、
`/admin/vector/:dbId/:colId` 各写了一次 `LazyPage(loadVectorPage)`，三次调用 = 三份 `lazy()`
= 下钻时页面也被整体重建。

改法：

- `<main>` 不再带 `key`，容器节点常驻，并显式 `bg-canvas`（空的正文区也是画布色，不是白纸）；
- 入场动画挪进 `<div key={pathname} className="anim-route">`，且 `fade-rise-soft` 从
  **opacity 0.35** 起淡而非 0 —— 最差情况是「略淡的当前页」，不会出现空白帧；
- 滚动位置改用 `mainRef.current?.scrollTo(0,0)`（保持原来换页回顶部的行为）；
- `pageLoaders.ts` 用 loader 引用做 `lazy()` 缓存 → 三级下钻共用一份 lazy，页面不重建；
- `LazyPage`（其实一直在返回元素、不是组件）改名 `pageView`，`src/pageView.tsx`，
  顺带修掉 eslint 的 `react-hooks/static-components`（渲染期创建组件）。

### B. 分片没预取，第一次进每个路由都要等一次网络

`Suspense fallback` 原来是 `<Loading/>`：一行居中 spinner，几十像素高，
下面整片是裸画布 → 视觉上是白屏。现在：

- `AppLayout` 挂载后在 `requestIdleCallback`（带 timeout，退回 setTimeout）里
  把 8 个页面分片全部 `preloadRoute()` 预取；动态 import 按 specifier 缓存，
  之后导航就是同步命中，`fallback` 基本不再出现；
- `fallback` 换成 `PageSkeleton`（有形状、有底色、`role="status"`），
  真的没预取到也只是骨架屏，不是一片白。

实测（`http://localhost:8000`，40 次采样）：`<main>` 节点跨路由**始终是同一个对象**、
`stageOpacity` 取值序列是 `0.35 → 0.907 → 0.976 → 1`（没有 0）、无空白帧、
8 个页面分片全部预取到。

### C. 部署后「首屏全白，手动刷新才好」—— 旧 index.html 引用了已被替换的分片

Vite 每次构建都给 `/assets/*` 换内容哈希名，`index.html` 里写死引用它们。
如果 `index.html` 被浏览器缓存（nginx 没给 HTML 设 `Cache-Control`，浏览器就走启发式缓存），
用户手上的旧 HTML 会去请求上一版构建的文件名 → 404 → **入口脚本没跑 → `#root` 永远是空的**。
手动刷新一把拿到新 `index.html`，于是「又好了」。这条与服务器性能无关，所以表现为
「部署到服务器上更严重」（dev 服务器永远给新 HTML）。

三层加固：

1. **服务端**：`apps/frontend/deploy/nginx.conf` —— `index.html` 强制
   `no-store/no-cache/must-revalidate`，`/assets/` 用 `immutable, max-age=1y`，
   `/api/` 反代 + `proxy_buffering off`（SSE 必须），并带 SPA 回退
   `try_files $uri $uri/ /index.html`（否则深链接刷新直接 404）。
2. **入口脚本 404 时 JS 无法自救**（自救代码就在那个没下下来的文件里），所以
   `index.html` 内联了一段**启动看门狗**：8 秒内 `window.__ametrineBooted` 没被置位，
   就用带 `?r=<ts>` 的地址重进一次（新 URL 绕开 HTML 缓存拿到新的 index.html），
   `sessionStorage` 标记保证只自救一次、不死循环；挂载成功后 `markBooted()` 清标记、
   并把 `?r=` 从地址栏抹掉。
3. **懒加载分片 404**（同一个版本错配的另一种形态）由
   `src/utils/chunkRecovery.ts` 接：监听 Vite 官方的 `vite:preloadError`，
   外加 `unhandledrejection` 里的 "Failed to fetch dynamically imported module" /
   "Unable to preload CSS"，同样只重载一次；`main.tsx` 里在 `RouterProvider` 外面
   补了**根级 ErrorBoundary**（原来只有页面级，路由匹配/守卫阶段抛错会把 `#root`
   清空 → 又是一次全白）。

另外 `index.html` 现在有内联关键样式（`html{background:#f6f7f9}` /
`html.dark{background:#0c0e12}`）和首帧前的主题脚本，慢服务器上「CSS/JS 还没到」
那段时间是深色底而不是白纸，同时消掉了深色主题的白闪。实测 `/login` 首屏
`getComputedStyle(html).backgroundColor === rgb(12, 14, 18)`，`html.className === "dark"`。

> 没能测的：真实像素截图（这个内嵌标签页 `visibilityState=hidden`，
> `take_screenshot` 不可用），以及「肉眼觉得闪不闪」。上面给的是 DOM 节点身份、
> 计算样式 opacity 与资源列表这一类可复测的断言。

---

## 二、后端依赖：不是「uv 冲突」，是代理把包索引打了 403

### 实测结论

```
# 当前配置（~/.config/uv/uv.toml: index-url = 清华源）+ 环境里的 HTTP(S)_PROXY=127.0.0.1:7897
uv pip compile - <<< 'xinference>=3.0'
  × No solution found when resolving dependencies:
  ╰─▶ Because xinference was not found in the package registry and you require xinference>=3.0 …
hint: An index (https://pypi.tuna.tsinghua.edu.cn/simple) returned a 403 Forbidden error.

# 同一命令，把索引域名放进 NO_PROXY（或 env -u 掉代理）
xinference==3.5.0            # 解析成功
```

`curl` 层面同样：`https://pypi.tuna.tsinghua.edu.cn/simple/xinference/` 走代理 **403**，
绕开代理 **200**（列表里有 3.2.0…3.5.0）；`pypi.org` 走代理是 TLS 断流
`error:0A000126 unexpected eof`；`mirrors.aliyun.com`、`hf-mirror.com`、`modelscope.cn` 都通。
另外 `apps/backend/.env` 里写的是 `HTTP_PROXY=http://192.168.128.1:7897`，
这个地址 curl 直接 `000` —— 它是 WSL **NAT 模式**下的宿主网关地址，
这台机器早就切到 `.wslconfig` 的 `networkingMode=Mirrored`，宿主代理现在在 `127.0.0.1:7897`。

所以「uv 一升级 xinference 就冲突、反而不能用了」里有两层：
一层是**索引被代理拒绝后 uv 报成「包不存在」**（看起来像依赖冲突）；
另一层是真正的依赖结构问题，见下。

### 真正的结构性问题：vllm 把 torch 钉死

- `pyproject.toml` 里 `xinference[all]==2.10`。`[all]` 会拉 `vllm`；
  `vllm-0.7.2.dist-info/METADATA` 里是 `Requires-Dist: torch==2.5.1`（**硬等号**），
  连带 `torchaudio==2.5.1`、`torchvision==0.20.1`、`triton==3.1.0`、`xformers`、
  一串 `nvidia-*-cu12` wheel。
- 新版 xinference（现 3.5.0）把 vllm 挪进了独立 extra：
  `vllm>=0.2.6; sys_platform=="linux" and extra=="vllm"`，
  基础依赖里 `torch` **不带版本约束**。也就是说 `[all]` 才是那条锁链的入口。
- 结果：应用侧想要新 `transformers`/新 xinference，就必须连 torch/triton/xformers/nvidia
  整条 GPU 栈一起换（几个 GB 的连带升级），而本机是 **RTX 2080 Ti（Turing sm_75，
  上报 22528 MiB 的改卡）**，新版 vLLM 对这类老架构的支持一直在收窄。
- 上一轮「`uv pip check` 463 包全兼容，所以不是依赖问题」这句话只对了一半：
  check 绿恰恰是因为这套环境**冻结**在 vllm 0.7.2 / torch 2.5.1 这个自洽但过期的点上，
  而这个点正是加载不了 Qwen3 的原因（`ModelRegistry` 115 个架构里没有 Qwen3）。
- **纠正一条我先写下、随后被第一手证据推翻的判断。** 我最初写的是「权重从没落盘」
  （因为 `du ~/.xinference/models/*` 什么都没打印）。真实结构不在 `models/` 而在
  `~/.xinference/modelscope/models/google/gemma-4-E2B-it/`：12 个文件、
  `model.safetensors` **10.25 GB、完整**。所以**问题不在下载，在加载**。
  而日志里那 75 条 `Model not found in the model list, uid: Qwen3-Instruct` 是连带噪音：
  `.env` 写的是 `XINFERENCE_LLM_MODEL_ID="Qwen3-Instruct"`，实际下载并尝试启动的是 `gemma-4`，
  gemma-4 加载失败 → 没有任何模型在跑 → 后端 `client.get_model()` 在每个请求的依赖注入阶段就报错。

### 模型起不来的第一手原因（`~/.xinference/logs/xinference.log`）

```
08:16:45 INFO  Model 'gemma-4' downloaded successfully to
               /home/young/.xinference/modelscope/models/google/gemma-4-E2B-it
08:16:45 INFO  Installing packages ['transformers>=4.53.3', 'accelerate>=0.28.0'] in
               virtual env ~/.xinference/virtualenv/v4/gemma-4/transformers/3.12.13
08:16:46 INFO  All required packages are already installed.
08:16:54 INFO  transformers.tokenization_utils_base  loading file tokenizer.model / chat_template.jinja
08:16:56 ERROR Failed to load model gemma-4-0
               ValueError: 'list' object has no attribute 'keys'      （elapsed 901 s）
```

报错的形状很说明问题：权重下完了、engine 依赖也检查过了，**真正 `model.load()` 时才炸**，
而且炸在读取新架构 config/processor 的地方（`list` 当成 `dict` 用）。
这是用户怀疑的「依赖问题」在模型这一侧的真实表现：`xinference 2.10` 所在的应用环境里
`transformers==4.57.6`，而 gemma-4 这种新架构需要更新的 transformers ——
我新建的推理环境解析出的正是 `xinference 3.5.0 + transformers 5.17.0`。
另外顺带一条：xinference 会为新模型创建 **per-model virtualenv**
（`~/.xinference/virtualenv/v4/<model>/<engine>/<py>`），这本身就是它处理引擎依赖漂移的方式，
也解释了为什么把推理栈和应用栈塞在同一个 venv 里会越走越拧。


### 已落地的处理

1. **`apps/inference/`：独立推理环境**（新建，含 `uv.lock`）。
   `xinference[transformers,embedding,rerank,audio,image]>=3.5,<4` —— **不装 vllm**。
   实测 `uv lock` 成功：360 个包，`xinference 3.5.0` / `torch 2.14.0` /
   `transformers 5.17.0`，`vllm` 不在依赖树里。torch 不再被钉死 ⇒ xinference 可以独立升级，
   而且不再牵动应用环境的 lock。
2. **`scripts/inference_env.sh`**：把包索引与权重源写进 `NO_PROXY`、设
   `UV_DEFAULT_INDEX`/`PIP_INDEX_URL`、`XINFERENCE_MODEL_SRC=modelscope`、
   `HF_ENDPOINT=https://hf-mirror.com`，并补上非登录 shell 缺失的 `~/.local/bin`。
3. **`scripts/setup_inference_env.sh`**：先自检索引可达性（不可达就报「先查代理」，
   而不是让人对着一句 "package registry 里没有" 猜），再 `uv lock` / `uv sync`，
   最后校验 `import xinference/torch/transformers`、`pip check`，
   并明确检查依赖树里**没有** vllm。
   - `--lock-only` 只做解析、不下载，用来验证「能不能解出来」。
4. **`apps/backend/.env`**：代理地址改成 `127.0.0.1:7897`，NO_PROXY 补索引/权重源域名，
   并写明服务器上若不需要代理就置空。
5. **`scripts/load_models.sh`** 重写：`source inference_env.sh`；从 `.env` 逐键取值
   （含之前漏掉的 `XINFERENCE_LLM_ENGINE` 与 `MAX_MODEL_LEN`）；已 `running` 的模型跳过；
   失败逐个汇报且打印 xinference 原始报错，命中 "Model not found in the model list" 时
   直接提示「是引擎没有 model_spec，不是模型不存在」；OCR 需要显式
   `XINFERENCE_LOAD_OCR=true` 才加载（过去它从来没被加载过）。
   修正 `--max_model_len`：脚本原来硬编码 10240，而 `.env` 是 `MAX_MODEL_LEN=30000`，
   前端按 30000 计费、后端只装 10240，长上下文会被静默截断。
6. **`scripts/wait_for_models.sh`** 重写：旧版只 grep 模型名是否出现在 `/v1/models`，
   而 xinference 把 `state=error/terminated` 的模型也列在同一个接口里 ——
   于是「等就绪」在模型已经启动失败时照样放行，dev.sh 接着起后端，
   用户看到的是「后端像坏了」。现在按状态判断：ready/running 通过，
   error/terminated **立刻失败**并指向 `~/.xinference/logs`，其余继续等，超时 900s。
7. **`dev.sh`**：xinference 优先用 `apps/inference/.venv/bin/xinference-local`
   （没有则退回应用环境并提示先跑 setup）；模型没就绪**照样启动后端**
   （原来 `wait_for_models && uvicorn`，等待一失败后端窗口就空转）；
   模型列表从 `.env` 读的方法与 `set -u` 下的空数组安全写法统一。

### 还没做的那一步（需要点头）

`apps/backend/pyproject.toml` 里 `xinference[all]==2.10` → 换成只需客户端的
`xinference-client`，应用环境就能把 vllm/torch/nvidia 那 3–4 GB 彻底摘掉。
代码侧是安全的：后端只用 `xinference.client`（`RESTfulClient`、
`client.handlers.AudioModelHandle`）+ 走 HTTP 的 langchain 封装，从不 import 服务端。
但改完必须 `uv sync` 才能生效，而 `uv sync` 会**真的从现有 .venv 卸包**——
万一中途断网，应用环境就会处于半改装状态。所以这一步留给你：
先跑 `bash scripts/setup_inference_env.sh`（新增目录，不动现有环境），
确认 9997 在新环境里跑起来之后，再动 backend 的依赖。
（顺带：客户端与服务端版本最好对齐，跨大版本调用 `AudioModelHandle` 需要实测。）

---

## 三、后端代码本轮改动（遗留项 #10 的第一批）

| 位置 | 问题 | 改法 | 实测 |
| --- | --- | --- | --- |
| `src/llm/service.py:103` `unify_filter` | 循环里反复覆盖 `doc["text"]`，命中的是多块时留下的是 rerank 降序里**最低分**那块 | 按 `(doc_id, chunk_id)` 保留最高分 | import + 行为待有模型后回测 |
| 同上 | `res[:p]` 截的是**向量检索顺序**的前 p 条，算完的 relevance_score 从没参与排序 | 全局按 `relevance_score` 降序后再截 p | 同上 |
| 同上 | 无命中时 `return "## No relevant documents…"`（字符串），而签名与调用方都按 `list[dict]` 用；`create_user_prompt` 的 `if context` 对非空串为真 → 遍历字符串字符 → 参考信息变成空串，模型收到「没有参考」却没有任何提示 | 返回 `[]`，走 `else` 分支的明确文案 | 同上 |
| `src/vector/documents/loader.py:83` | 请求路径里 `exit(0)` = `SystemExit`，上传一份解析不出文本的文件（扫描件/空 PDF）就能把 uvicorn 进程带走 | 抛 `ValueError` 说明原因 | import ok |
| `src/user/controller.py` | `/user/all`、`/user/{id}`、`PATCH`、`DELETE` **全无鉴权**；`/user/all` 匿名给全站用户名，叠加 `/api/auth` 区分「用户不存在/密码错」= 完整枚举链；登录用户可以 `PATCH` 自己 `role_id=3` 升管理员 | 四个端点都要 token；读/改/删限「本人或管理员」；`role_id` 只有管理员能改；`/user/create`（注册）保持匿名可达 | 匿名 `/user/all` → 401；带 token → 200；读他人 → 403；读自己 → 200；自改 role_id → 403（返回「只有管理员可以调整角色」）；自改每日限额 → 200；删他人 → 403 |
| `src/chat/controller.py` + `src/chat/history.py` | `ensure_conversation` 不写 `user_id`（于是会话在按用户过滤的 `/conversation/list` 里永不可见、也永删不掉 = 那批神秘空行）；只按 id 查，报别人的 `conversation_id` 就能读写别人的历史；`/api/chat` 整体无鉴权 | `/api/chat` 加 `get_current_user`；`ensure_conversation(..., user_id)` 写入并校验归属，历史遗留的无主行顺带认领给当前用户；鉴权依赖排在模型依赖之前 | 匿名 `POST /api/chat` → 401（改顺序前是 500，因为 `get_llm_service` 先打 xinference 就炸了） |
| `src/middleware/logger.py` | `propagate=False` + `basicConfig(filename="ametrine.log")` ⇒ 文件 handler 只挂在 root 上，本 logger 的日志永远进不了文件，事后无日志可查 | 显式再挂一个 `FileHandler` | `ametrine.log` 已有内容，handlers = `[StreamHandler, FileHandler]` |

改动过程中自己被实测抓到的一次真实破坏：`src/chat/controller.py` 第一版忘了
`from fastapi import ... HTTPException, status` 和 `get_current_user`，
`--reload` 热加载直接把开发后端打挂（所有探测 `000`）。补上 import 后
`/health` 恢复 200，鉴权探测才有意义。

## 四、验证清单

- 前端：`npm run check`（tsc + eslint + vitest）`CHECK_EXIT=0`；`npm run build` `BUILD_EXIT=0`；
  `dist/index.html` 内联样式与看门狗在位，bundle 里含 `vite:preloadError` 与 `ametrine:boot-reload`。
- 浏览器实测：见上文「B / C」段落的数据。
- 后端：6 个 shell 脚本 `bash -n` 全过；6 个改动模块 + `main` 可导入；
  `/health`、`/openapi.json` 200；鉴权 9 项探测全部符合预期。
- 依赖：`apps/inference` `uv lock` 成功（360 包，无 vllm）。

## 五、升级 xinference 到 3.x 会撞上的第二道墙：服务端开始强制鉴权

实测（新推理环境起的测试实例，端口 9998）：

```
GET /v1/models                     → 401 {"detail":"Could not validate credentials"}
启动日志：FIRST-RUN SETUP REQUIRED
          Create the initial admin account at POST /v1/admin/setup
POST /v1/admin/setup {username,password} → 201 {"id":1,"username":"ametrine"}
```

而 `xinference 2.10` 那台（9997）是匿名可读可写的。也就是说**大版本升级不是换个 pip 号就完事**：
`src/client.py` 的 `RESTfulClient(xinference_addr)` 当时不带凭证，`langchain_community.XinferenceEmbeddings`
更是自己 new 一个匿名 client —— 升级后会 401。
（`langchain_xinference.ChatXinference` 虽然也 import 了，但全仓库没人调用，不在这条风险里；
chat/rerank/STT 走的是 `client.get_model(...)` 拿到的 handle，`handle` 会收到 `auth_headers`，
所以凭证接线一做它们就顺带好了。这一点是我后来逐个查调用点才纠正的，见附一节的表。）

可用的开关（从 `.venv/.../xinference/` 里 grep 出来的常量名，按出现次数）：
`XINFERENCE_AUTH_ADVANCED`(10)、`XINFERENCE_AUTH_DIR`(8)、`XINFERENCE_ES_AUTH`(7)、
`XINFERENCE_AUTH_DB_PATH`(7)、`XINFERENCE_API_KEY`(4)、`XINFERENCE_AUTH_JWT_SECRET_KEY`(3)、
`XINFERENCE_AUTH_ENCRYPTION_KEY`(3)，限流三项
`XINFERENCE_RATE_LIMIT_KEY_{WINDOW_SECONDS,MAX_FAILURES,BAN_SECONDS}`(各 4)。

> **这里更正我先前的一句错判**：我写过「`RESTfulClient(addr, api_key=…)` 支持该参数，
> langchain 的两个封装也有同名字段」。**后半句是错的**，实测：
> `XinferenceEmbeddings.__init__` 只有 `(server_url, model_uid)`，
> `ChatXinference` 的字段里也没有 `api_key`（它自己内部 new client）。
> 所以「换掉这两个封装」不是可选项，是升级 3.x 的前置条件。

### 升级执行清单（请求体形状逐条对着 3.5.0 的 routes.py 核过）

| 步 | 动作 | 依据/注意 |
| --- | --- | --- |
| 1 | `uv sync` 好的 3.5.0 服务器起来（`dev.sh` 已优先用 `apps/inference/.venv/bin/xinference-local`），把 `XINFERENCE_HOME`/`XINFERENCE_AUTH_DIR`/`XINFERENCE_AUTH_DB_PATH` 指到一个**新目录** | 别复用 9997 那台的数据。**实测（一次性 9998 实例）**：起服务约 30 秒，**起来那一刻 `/v1/models` 就是 401**——鉴权是默认强制、不是可选开关。想让临时实例不往 `~/.xinference` 写账号/密钥：把那三个变量指到 `/tmp`，再把 `~/.xinference/modelscope` 软链回去，就能既命中缓存又不污染家目录 |
| 2 | `GET /v1/admin/setup/status` → `POST /v1/admin/setup {"username","password"}` | 实测 status 形如 `{"needs_setup":true,"initialized":false,"password_min_length":8}`；建完 **201** `{"id":1,"username":…}`。完成后同一端点**永久 403**（防被继续探测口令策略） |
| 3 | `POST /token` `{"username","password"}` → 拿 JWT | 实测 **200**，`access_token` 是 647 字节 HS256 JWT。管理面要 Bearer JWT，不是 API key；`/v1/admin/keys` 的读还额外要求 `keys:create` 或 `keys:manage`（或 `admin` 通配） |
| 4 | `POST /v1/admin/keys` `{"name","description?","expires_at?","model_permissions?","rate_limit_max_failures?","rate_limit_window_seconds?","rate_limit_ban_seconds?"}` → 201 | 实测返回字段是 **`['id','key','name','prefix']`**：明文在 **`key`** 里（**不是 `api_key`**），形如 `xf-…`，且只有这一次可见，必须当场存下。拿它 `Authorization: Bearer xf-…` 访问 `/v1/models` 实测 **200**，错 key **401**。限流是**按 key** 计的——这条直接决定第 6 步会不会重演我踩到的 429 |
| 5 | 把 key 填进 `apps/backend/.env` 的 `XINFERENCE_API_KEY` | **本轮已完成并测通**：接线 + embedding 封装替换，凭证契约 8/8、embedding 12/12 |
| 6 | 应用侧并发对齐：`SEMAPHORE=32` vs key 的 `rate_limit_max_failures` | 我探测时被这台限流过（429），32 并发的应用撞得比我狠 |
| 7 | `scripts/load_models.sh` + `wait_for_models.sh` 在新端口上跑通，再切 `XINFERENCE_MAIN_ADDR` | 顺序别反：先证明服务器可用，再动应用的地址 |

**第 1~6 步我没有执行**：它们会改变你推理服务的鉴权语义并写入新密钥，属你点名的范围。

## 六、顺手挖出来的四处鉴权漏口（本轮全部已修并复测）

前端真正调的是 **`/api/llm/chat` 与 `/api/llm/rag`**，不是 `/api/chat`
（`api/chat.ts` 里写死了 `${API_BASE}/llm/chat`）。检查这四个端点后：

| 端点 | 修前 | 修后 |
| --- | --- | --- |
| `/api/llm/rag` | 声明了 `get_current_user`，但排在 `document_service`/`service` **之后**，依赖先炸 → 匿名请求实测 **500** | 把 `current_user` 提到最前 → 实测 401 |
| `/api/llm/chat` | **完全没有鉴权**：任何人不带凭证就能占 `SEMAPHORE=32` 的信号量、烧推理算力 | 加 `get_current_user`，且排在模型依赖之前 → 实测 401 |
| `/api/chat` | 无鉴权、且 `ensure_conversation` 不写 `user_id` | 加鉴权 + 归属校验（虽然前端暂时没调它，属留了个洞的备用入口） |
| `/api/llm/references` | 无鉴权，且 `loads(None)` 让未知/过期 session 直接 **500**；引用内容含知识库文档标题，任何人不登录就能读别人的引用 | 加 `get_current_user`；Redis 键改成 `chat_ref:{user_id}:{session_id}`，取不到时返回 `[]` 而不是炸 |

实测（本机 :3000，`--reload` 生效后复测）：

- 匿名六项全部 `401`：`/api/llm/chat`、`/api/llm/rag`、`/api/chat`、`/api/llm/references`、
  `/api/user/all`；`/health` 仍 `200`。
- 登录态三项（临时账号 uid 29/30，用完已删并复验 `/api/auth` 返回「user not found」）：
  本人读自己的 session → `200 data:[{"title":"探针文档",…}]`；
  另一用户读同一个 session_id → `200 data:[]`（键里的 user_id 挡住了）；
  不存在的 session → `200 data:[]`（不再是 500）。
  探针脚本自己第三行的断言写错了（空 marker 使 `case *""*` 恒真而误报 FAIL），
  结论以上面打印出的真实响应体为准。
- 前端兼容性核对：`api/chat.ts` 取引用走的是 `result.data || result`，且带
  `authHeaders()`——`[]` 在 JS 里是真值，所以空数组会原样变成 `[]`，「无引用」判定不受影响。

## 七、遗留项 #9（访问路由就建会话）本轮已完成

`useSessionMessages` 不再在 `convId` 缺失时 `createSession`：裸 `/chat`、`/rag` 保持
`currentSessionId = null`；首次发送时 `ensureSession()` 才建会话并把 URL 换成
`/chat/<id>`；深链指向已删除会话时退回裸路由而不是新建。
代价是不能再依赖「路径变化 → 整棵子树重建」来重置消息，所以：
`AppLayout` 的舞台分段键从 `location.pathname` 改成**路由根** `routeRoot`
（`/chat → /chat/<id>` 属同一页面，若在这里重建，正在流式输出的 token 会随旧组件一起丢），
会话之间的消息切换则由 hook 里一个显式的 `convId` 同步 effect 负责。
门禁：`npm run check` 真实退出码 0（tsc + eslint + 42 例全过）。

## 八、留给你的决定

1. 是否执行「把 backend 的 `xinference[all]` 换成 `xinference-client`」——见上文风险说明。
   本轮新增一条相关事实：`langchain_xinference` 在代码里**已经没有引用**（那句 `ChatXinference`
   是死导入，已删），`langchain_community` 也只剩文本切分器还在用。所以这个瘦身比想象中更接近可做，
   但仍要 `uv sync` 真卸包（断网会留半改装状态），依旧等你点头。
2. `bash scripts/setup_inference_env.sh`（新环境，几个 GB）与
   `bash scripts/load_models.sh`（权重约 11 GB）——现在脚本已就绪，等你说跑。
3. **`.env` 里的 `XINFERENCE_LLM_MODEL_ID="Qwen3-Instruct"` 与实际下载并尝试启动的
   `gemma-4` 不是同一个模型**，这个不一致要么改配置、要么换权重，需要你先定；
   同时 gemma-4 的 `model.safetensors` 是 10.25 GB，这张有效显存约 11 GB 的改卡余量很紧。
4. 升级到 xinference 3.x 前要不要先把 API key 那条链路（服务端 + 客户端 + 脚本）补上，
   否则升完就是全线 401。
   **本轮进展**：客户端侧已经接好并用假服务器**当场测通**（`XINFERENCE_API_KEY` →
   `RESTfulClient(api_key=…)`，2.10/3.5.0/应用接线共 8 条断言全过，见附一节），
   同时实测确认 langchain 的两个封装（`XinferenceEmbeddings` / `ChatXinference`）**没有** api_key 入口，
   所以「要不要换掉这两个封装」不再是可选优化，而是升级 3.x 的**前置条件**——见附一节。
   服务端侧（`/v1/admin/setup` + `/token` + `/v1/admin/keys` 签发）仍未做，那会改你这台服务器的鉴权语义。
5. `/api/user/all` 现在「登录即可读全站用户名+邮箱」。要不要收到 admin-only？
   那会让概览页「全站用户数」卡片对普通用户失效，属于接口契约变更（第二批范围）。
6. 检索质量标定：`MIN_RELEVANCE_SCORE=0.3` 现在作用在真正参与排序的分数上，含义变了，
   最好用一组问答集定阈值。
7. 遗留未动：whisper 两张表的 drop 迁移（46 条文字仍在库里）、
   `user.system_prompt` 走「永远在场」还是「可检索可引用」、
   中文分块修复后的**重新索引**（破坏性，需点名）。


## 九、脚本硬化：三处「假绿」和它们各自的证据（2026-09-29 补）

`setup_inference_env.sh` 的校验段原先有三处会**在失败时也打印成功**，全部已改掉并实测。

1. **`uv run -- pip check` 根本跑不起来。** 这个 venv 里没有 pip（实测
   `python -m pip --version` → `No module named pip`，`ls .venv/bin | grep -c '^pip$'` → 0），
   所以那句只会输出一条报错，反而像环境坏了。换成 uv 自己的 `uv pip check`，实测输出
   `Checked 349 packages` / `All installed packages are compatible`。
2. **「依赖树里不该有 vllm」这条断言永远报绿。** 原写法是
   `if uv run -- pip show vllm; then 报警 else 报绿`，而实测 `uv pip show vllm` 在包不存在时
   只往 stderr 打一句 `Package(s) not found for: vllm`、**退出码仍是 0**——
   也就是说它连「pip 不存在」和「vllm 不存在」两种情况都投同样的退出码。
   现在改成用 `importlib.util.find_spec("vllm")` 打印 `present/absent`，
   `case` 只认这两个字面值，第三种情况（python 没跑起来）直接 `exit 1`——**判不出来不等于通过**。
3. **单次 403 不能当「索引不可用」。** 我在同一台机器上先看到清华源 403、十几分钟后再测同一个
   URL 是 200（带代理、剥掉代理都是 200，说明 `NO_PROXY` 那段是生效的，403 是镜像站的瞬时抖动）。
   原逻辑拿一次采样就 `exit 2`，会把一次本来能装的安装拦死。现在：同一索引重试 3 次 →
   再退到备用索引（只列 `pypi.org` 与 `mirror.sjtu.edu.cn`，因为
   `mirrors.aliyun.com/simple/xinference/` 稳定 404，拿它当候选只是再浪费一次超时）→
   全不可达才报错。回退路径实测走通：配置成 aliyun 时打出三次 404、备用探测 pypi.org=200、
   改用 `https://pypi.org/simple` 后继续往下走解析。**代价要如实说**：换索引会让 `uv lock` 整树重解，
   这一次重解在本机跑了 10 分钟以上仍未结束（索引没变时它是 1ms 命中），所以我把那次 `uv lock` 进程
   终止了——门禁与回退这段行为已经被日志完整证明，没必要为它等一次全量重解；终止后比对确认
   `apps/inference/uv.lock` 未被改写。结论是：**回退是「能装成」而不是「装得快」**，
   真要用备用索引装一次，得留出几十分钟。

另外两件事：

- 六个 shell 脚本 `bash -n` 全部 OK（`inference_env.sh`/`load_models.sh`/`setup_inference_env.sh`/
  `wait_for_models.sh`/`wait_for_service.sh`/`dev.sh`）。
- 本轮又踩实了一次「退出码会撒谎」：`wsl.exe … bash script > /dev/null; echo $?` 对一段
  实际 `exit 2` 的脚本返回了 0。所以现在一律让脚本**自己把状态写进日志**
  （`EXIT_NORMAL=$?` 这种在 WSL 内部求值），再读日志下结论。

**仍未跑**：`scripts/load_models.sh` 本身（它连的是 9997，那台还是 2.10，跑了也只会复现
「Model not found in the model list」）。**但「3.5.0 能不能真把模型起来、能不能真推理」这件事
已经在下一节用一次性实例跑通了**，不需要再等 11 GB 下载。

## 十、遗留项 #11（`user.system_prompt` 死控件）本轮已完成，顺带修掉一处流式炸点

这个字段之前的状态和《丛书》一模一样：Profile 能编辑、DTO 有列、库里存着，但
`chat/controller.py` 与 `llm/controller.py` 只用 `prompt.py` 的模块常量 —— 改它没有任何效果。
它当初被搁置的唯一理由是「`/api/chat` 还没鉴权，拿不到当前用户」，而鉴权已在前几轮补齐，所以本轮接上。

**语义选择（这条替用户定了，写在下面供否决）**：`compose_system_prompt()` 把个人偏好
**叠在系统提示之后**，不是替换。理由是一句个人偏好不应该把整段助手规范——尤其 RAG 那条
「参考资料里没有就如实说不知道」——抹掉。留空时返回值**逐字节等于**原常量，所以没填过的账号输出不变。
另外它有个 4000 字的截断上限：这是唯一直接进 system 消息的用户输入，不设限等于让一次粘贴挤掉上下文窗口。

同时明确**不采信** `ChatRequest.system_prompt`（客户端自带的同名字段）：
让请求方随意覆盖系统提示，等于把 RAG 的引用约束交给调用方关掉。这个字段仍是死的，建议第二批清掉。

接了四个出口：`/api/llm/chat`、`/api/llm/rag`、以及 `/api/chat` 的 llm/rag 两条流。

顺带修的是流式解析里的一处真炸点：`LLMService.stream_by_token` 直接索引
`chunk["choices"][0]["delta"]["content"]`，而 OpenAI 兼容流的**第一个 delta 常常只有
`{"role":"assistant"}`**、工具调用帧整帧没有 `content` —— 这两种帧都会 KeyError 把整条回答打断。
`/api/chat` 那侧早就用 `_chunk_content` 做防御式取值了，两条路径现在语义一致。

验证 17/17（`python -u .tmp-sysprompt.py`，用完已删）：

- `compose_system_prompt`：`None`/纯空白 → 逐字节不变；有值 → 叠加且原提示仍在；超长截到 4000。
- `stream_by_token`：role-only 首帧 + 工具帧 + 空 `choices` 三种帧都不再炸流，token 顺序正确。
- 真实 HTTP：临时账号 `PATCH /api/user/{id}` 写 `system_prompt` → 200，`GET` 读得回原值。
- 直接 `await` 端点协程（服务与鉴权用替身，不碰 DB）：`/api/llm/chat` 与 `/api/llm/rag`
  出站的 `messages[0]` 确实含个人偏好、且以原系统提示开头；未填偏好的账号拿到的
  `messages[0]` 与改动前**逐字节相同**；`X-Session-ID` 头仍回传。
- 清理：临时账号已删（登录返回 401 `user not found`），三个探针账号全部复验不存在。

这一轮同样有三次「断言自己错了」要认：两次拿明文去搜 `ensure_ascii` 转义后的 `\uXXXX`
（流其实正常吐了 token），一次拿被删账号自己的 token 去 `GET`（只会得到 401，证不了删除）。
另有两次工具链自扰：`BaseHTTPRequestHandler` 的模式写在实例上没生效、
以及 `wsl.exe` 内联串里 `$var` 被外层吃掉导致检查输出为空——都靠改成脚本文件+类属性才拿到真结果。

**仍未验证的**：以上只证明「消息拼对了」，不证明「模型会照个人偏好执行」——
那要真模型在场才能测，仍然卡在同一台没有模型的机器上。

## 附：关于 3.5.0 鉴权的一条自我更正

上面第 3 段我写的是「最省事的一条是给服务器设 XINFERENCE_API_KEY，客户端统一带上」——
这是推测，实测**不成立**：我只给服务器设了 XINFERENCE_API_KEY 再用同一个值当 Bearer token，
/v1/models 仍然不是 200（反复探测后还吃到 **429**，说明限流也在生效）。
按包里 grep 到的常量与端点，3.5.0 带的是一整套鉴权子系统而不是单个开关：
XINFERENCE_AUTH_ADVANCED(10 处)、XINFERENCE_AUTH_DIR(8)、XINFERENCE_AUTH_DB_PATH(7)、
XINFERENCE_API_KEY(4)、XINFERENCE_AUTH_JWT_SECRET_KEY(3)、XINFERENCE_AUTH_ENCRYPTION_KEY(3)；
管理面是 POST /v1/admin/setup → /v1/admin/users → **/v1/admin/keys**（签发/吊销 API key）
→ /v1/admin/security/{rate-limit,banned-ips,banned-keys}。
所以正确的升级清单是三段：**依赖拆分（本轮已完成）+ 走 /v1/admin/keys 签发 key 并让
RESTfulClient / langchain 封装带上（未做）+ 限流预算（未做，应用侧并发=SEMAPHORE 32，会撞 429）**。

也因此，本轮的模型加载验证停在了诚实的边界上：
新环境能装（xinference 3.5.0 / transformers 5.17.0 / torch 2.14.0+cu130）、
在这张 sm_75 卡上 CUDA 真算得动（matmul 通过），
但「gemma-4 在新环境下能否加载到 ready」必须先把鉴权链路打通才能测——
我没有为了跑通测试去改服务器的鉴权语义（那是要你点头的事）。

### 补（2026-09-29）：`RESTfulClient` 的 api_key 到底怎么生效——两个版本的源码都对上了

把 2.10 与 3.5.0 两边的 `RESTfulClient.__init__` 都打出来看，逻辑一字不差：

```python
def __init__(self, base_url, api_key: Optional[str] = None):
    self._headers: Dict[str, str] = {}
    if api_key is not None and self._cluster_authed:
        self._headers["Authorization"] = f"Bearer {api_key}"
```

这条实测修正了两件事：

1. **密钥不是无条件生效的**，它要求 `self._cluster_authed` 为真（客户端自己去问集群的鉴权状态）。
   所以本机这台没开鉴权的 2.10 服务器上，`client._headers` 实测就是 `{}` ——
   我按 `api_key=…` 传了值，头里也不会有 Authorization。这正是「传了 key 但 /v1/models 仍非 200」
   那个现象的另一半解释：**key 有效与否由服务器是否 authed cluster 决定**，不是客户端能单方面塞的。
2. 因此本轮把 `XINFERENCE_API_KEY` 接进 `RESTfulClient` 之后，用一台**假服务器**把这条链路
   当场测通了（判据是服务器实际收到的头，不是客户端内部状态）：
   `GET /v1/cluster/auth` 分别应答 `{"auth":true}` / `{"auth":false}` / `404`（旧版），
   然后断言 `GET /v1/models` 线上有没有 `Authorization`。8 条断言全过：

   | 客户端 | auth:true | auth:false | 404（旧版） |
   | --- | --- | --- | --- |
   | 生产在用的 2.10 `RESTfulClient` | 实收 `Bearer sk-…` ✓ | 无 `Authorization` ✓ | 无 `Authorization` ✓ |
   | 升级目标 3.5.0 `RESTfulClient` | 实收 `Bearer sk-…` ✓ | 无 `Authorization` ✓ | 无 `Authorization` ✓ |
   | 应用侧 `src.client`（本轮接线） | 实收 `Bearer sk-…` ✓ | 无 `Authorization` ✓ | — |

   结论两句话：**key 只在服务器自报开了鉴权时才会发出去**（所以今天这台 2.10 不填 key 也一切照旧，
   填了也不会突然带上凭证），而**换成 3.x 开了鉴权的集群后，应用侧不需要再改代码**——
   真正没解决的是下面第 3 点的两个 langchain 封装。
   边界要说清：这测的是**客户端行为契约**，不是「真 3.5.0 集群签发 key 后放行」；
   后者要等第 1~4 步在你机器上真跑一次才能确认。
   顺带记一句教训：这个假服务器第一版把 5 条断言报成 FAIL，原因是我在 handler 实例上写
   `self.mode = …`——每个请求都是新实例，模式从没真正切过。改成写类属性 `Handler.mode` 才拿到上面的结果。

同时把封装层的硬限制写进了 `src/client.py` 的注释里，避免下次重新发现：
`XinferenceEmbeddings.__init__` 实测只有 `(server_url, model_uid)`，`ChatXinference` 的字段里
也**没有** `api_key`（它内部自己 new client）。

### 再更正一次：真正有缺口的只有一个封装，而且本轮已经换掉了

上面写「换不掉这两个封装就升不了级」，把范围说大了。逐个查调用点之后：

| 路径 | 实际用的东西 | 带不带凭证 |
| --- | --- | --- |
| chat | `client.get_model(...)` → `RESTfulChatModelHandle`（`handle` 收到 `auth_headers=self._headers`） | **本来就带** |
| rerank / STT | 同上，走 `client` 拿到的 handle | **本来就带** |
| `ChatXinference` | 只出现在 import 行，**全仓库无人调用**（死导入） | 不适用 |
| embedding | `langchain_community.XinferenceEmbeddings` 自己 `RESTfulClient(server_url)`，签名里没有 api_key | **这是唯一的真缺口** |

已把它换成 `src/client.py` 里的 `CredentialedEmbeddings`：走同一个共享 `client`，
`isinstance(..., langchain_core.embeddings.Embeddings)` 成立，所以 `SemanticChunker` 照旧接受；
请求语义刻意保持一致（一条文本一次 `/v1/embeddings`，不做批量，避免引入顺序错位的_new_风险）。

用假 xinference（会回 `/v1/cluster/auth`、`/v1/models/{uid}`、`/v1/embeddings`）跑真实调用路径，
两种模式 12 条断言全过：

- 服务器开鉴权 → 应用发出的**每一个**请求都带 `Authorization: Bearer sk-…`；
- 服务器未开鉴权 → 一个凭证头都不发（与今天这台 2.10 的行为完全一致，零回归）；
- `embed_query` 数值正确、`embed_documents` **顺序不错位**、路径仍是 `/v1/embeddings`、
  请求体仍带 `model`，条数仍是「每条一次」。

顺带说明：第一次跑有 2 条 FAIL，是我断言把 `embed_query` 的那一次算进了 `embed_documents` 的次数里，
代码没问题；把两程分开计数后 12/12。

## 附二：A/B 实测把因果钉死了（同一份本地权重，两个环境）

权重自身声明：model_type = `gemma4`，architectures = `Gemma4ForConditionalGeneration`，
dtype = bfloat16，35 层，5.51 B 参数。

| 检查 | 旧环境 apps/backend/.venv（xinference 2.10 + transformers 4.57.6） | 新环境 apps/inference/.venv（xinference 3.5.0 + transformers 5.17.0） |
| --- | --- | --- |
| `transformers.models.gemma*` 目录 | gemma、gemma2、gemma3、gemma3n | 另有 **gemma4、gemma4_assistant、gemma4_unified、gemma4_unified_assistant** |
| `hasattr(transformers, "Gemma4ForConditionalGeneration")` | **False** | True |
| `CONFIG_MAPPING` 是否认得 gemma4 | **False** | True |
| `MODEL_FOR_CAUSAL_LM_MAPPING_NAMES` 里有无 gemma4 | 无 | **有**（同时出现在 MULTIMODAL_LM / IMAGE_TEXT_TO_TEXT / PRETRAINING / MODEL 注册表） |
| `AutoConfig.from_pretrained(本地目录)` | **ValueError: Transformers does not recognize this architecture** | Gemma4Config 解析成功 |
| `AutoModelForCausalLM.from_config`（meta 权重，不占显存） | 同上失败 | **Gemma4ForConditionalGeneration 构造成功，5.51 B 参数，3.2 s** |
| tokenizer 与 chat template | —— | GemmaTokenizer 可用，模板形如 `<\|turn>user…<turn\|>` |
| xinference 模型族文件 | `model/llm/llm_family.json` 里**没有 gemma-4** | `model/llm/models/gemma-4.json` 存在 |

**结论一：用户怀疑得对，这就是依赖问题。**
gemma-4 在旧环境里连 config 都解析不出来 —— `transformers 4.57.6` 根本没有 gemma4 这个模型家族，
xinference 2.10 的模型族清单里也没有它。旧环境为什么钉在 4.57.6 上不去：
`xinference[all] → vllm 0.7.2 → torch==2.5.1` 这条硬锁链，加上 vllm 0.7.2 对 transformers
内部 API 的假设，使应用环境不可能既留着 vllm 又升到 transformers 5.x。
日志里那句 `'list' object has no attribute 'keys'` 是 xinference 2.10 在拿不到 model_spec 时
走进解析分支的次生报错，不是显存问题，也不是权重损坏。

**结论二：升级解决依赖，但解决不了显存 —— 这是两件事，得分别决定。**
同一台机器实测：`free` 总 15 GB / 可用 10 GB；`nvidia-smi` 报 22528 MiB（改卡上报值，
实际 11 GB），已用 1323 MiB。gemma-4 是 5.51 B 参数，bf16 权重 **10.3 GiB**，
加 KV cache 一定进不了 11 GiB，连「先在 CPU 上组装」都不够（可用内存只有 10 GB）。
所以 `XINFERENCE_LLM_MODEL_ID` 指到哪必须你选：

1. 用 `.env` 里本来就写着的 **Qwen3-4B**（Transformers 引擎有 spec；4B bf16 约 8 GiB，
   配 4k~8k 上下文能进 11 GiB）；
2. 或者继续 gemma-4 但换 **量化格式**（gptq / awq / gguf，需要另下对应权重）；
3. 不建议为了 gemma-4 bf16 去争那 1 GiB 余量。

两条合起来就是「一些模型很久起不来」的完整答案：
**旧依赖不认这个架构（本轮已用隔离环境解决）+ 这个模型的 bf16 体积超过这张卡（需要你换模型或换量化）。**

> 上面这半句里只有「旧依赖不认这个架构」还成立。**显存那半句是我推算错的**，
> 下面的端到端实测把 gemma-4 bf16 真的装进了这张卡并跑出了回答，见 §十一。

## 十一、端到端实测：3.5.0 能把模型起来，而且真的能推理（2026-09-29）

前面十章里「模型起不来」全部停在推断层面。本轮在一次性隔离实例上把这个问题彻底问穿了。

### 环境

- 另起一个 `xinference-local -H 127.0.0.1 -p 9998`，与你的 9997 端口隔离；
  `XINFERENCE_HOME=/tmp/ametrine_xin_home`，其中 `modelscope` 是指向
  `~/.xinference/modelscope` 的软链 —— 目的是命中已缓存权重，**不下载 11 GB**。
- 权重确认是完整的：`modelscope/models/google/gemma-4-E2B-it/model.safetensors`
  = 10,246,621,918 B（此前我在 `cache/v2/gemma-4-pytorch-2b-none/` 里看到的
  「66 字节的 model.safetensors」是**软链本身的大小**，不是残缺文件；`find` 不加 `-L` 就会报这个数，
  我差点据此判成「下载损坏」）。

### 实测时间线（全部为观测值，非推算）

| 步骤 | 结果 |
| --- | --- |
| `GET /v1/models`（无凭证） | **401**（3.x 强制鉴权，与 §五 一致） |
| `POST /token`（用户名+口令） | **200**，拿到 647 字符 JWT |
| 带 JWT `GET /v1/models` | **200** |
| 用 **API key** launch | **403** `API keys can only access model query and inference endpoints` |
| 用 **JWT** 走 CLI `xinference launch … --model-engine Transformers` | **exit 0**，`Model uid: gemma-4` |
| launch 后前 ~3 分钟 | `/v1/models` 里**没有这个条目**（列表为空），显存 1336 MiB |
| 约 3 分钟后 | 条目出现，显存 **11,349 MiB** |
| `POST /v1/chat/completions`（用 **API key**） | **200**：`choices[0].message.content = "2"`，`usage 24+1=25` |
| 收尾 `DELETE /v1/models/gemma-4` → 停实例 | 显存回落 **1333 MiB**；9997/`:8000`/`:3000` 全 200 |

「控制面用 JWT、数据面用 API key」这条分工至此是**实测结论**，不再是源码推断。

### 顺带挖到的两条真因（都比脚本改动重要）

1. **3.5.0 的 `/v1/models` 条目里没有 `state` / `status` 字段。**
   实测键集合只有 `id / model_name / model_engine / model_format / quantization / replica /
   accelerators / context_length / …`。而副本是**加载完成后才登记进列表**的。
   这意味着只认 `state` 的老代码在 3.x 上会：`wait_for_models.sh` **永远判不成 ready、干等到超时**；
   `load_models.sh` 的 `running_state` **恒为空 → 对已运行的模型反复 launch**。
   A/B 实测（同一份真实响应）：旧逻辑 `gemma-4 -> '' => ready? False`；
   新逻辑 `running_state(gemma-4) => [running]`、`running_state(未加载) => []`，
   `wait_for_models.sh --endpoint …/v1/models -- gemma-4` 打出 `✓ 所有模型已就绪`、`wait_exit=0`。
   （更正 §五/§九 里另一句：我之前用「401 会被读成 unreachable 所以会挂」解释这脚本的动机，
   那个 A/B 两边都返回 `absent`，**并没有证明这一点**；上面这组才是有效证据。）

2. **真正给你服务的那个进程，用的根本不是新环境。**
   `ps` 实测 9997 是 `uv run -- env XINFERENCE_MODEL_SRC=modelscope xinference-local`，
   解释器为 **`apps/backend/.venv/bin/python3`**；版本对照：

   | | apps/backend/.venv（**正在服务 9997**） | apps/inference/.venv（新装的） |
   | --- | --- | --- |
   | xinference | **2.10.0** | **3.5.0** |
   | vllm | 0.7.2 | 无 |
   | transformers | 4.57.6 | 5.17.0 |
   | torch | 2.5.1 | 2.14.0 |
   | xinference-client | 1.16.0 | （由 xinference 自带） |

   所以「装了 3.5.0 但模型还是起不来」的机制很直白：**装新版的 venv 和跑服务的 venv 不是同一个**。
   `apps/backend/pyproject.toml:41` 写的是 `xinference[all]==2.10` —— 后端只要客户端，却把
   整个服务端连同 `vllm 0.7.2 → torch==2.5.1` 这条锁链一起拖进了应用环境。这正是你
   「一升版本就和其它依赖冲突」的那面墙：冲突不在后端，在于后端顺手养了一个旧的服务端。

3. **后端换 `xinference-client` 不需要担心动作面 API。** 实测
   backend 里那份 `xinference-client 1.16.0` 的 `RESTfulClient.__init__(self, base_url,
   api_key: Optional[str] = None)` 已支持 api_key，且 `hasattr(RESTfulClient, "get_model")` 为
   True —— 也就是本轮写进 `client.py` 的凭证接线（含 `CredentialedEmbeddings` 用的
   `client.get_model(...).create_embedding`）**在当前已装的客户端版本上就能跑**，不必为了它升版。
   未测的部分要如实说：我没做「1.16.0 客户端 ↔ 3.5.0 服务端」的端到端推理，
   端到端只验证了 REST 层（表格最后一行）。

4. **3.x 的 `virtualenv` 字段是我在依赖分析里漏掉的一块。** `gemma-4.json` 里声明了
   `transformers>=5.10.0 ; #engine# == "Transformers"`、`vllm>=0.22.0 ; #engine# == "vllm"` 等
   **按引擎隔离的依赖**，xinference 会为单个模型另开一个 venv。这条机制的存在本身就是答案的一部分：
   **升级到 3.x 之后不需要让主环境去兼容最新模型**。本次成功加载用的是
   `apps/inference/.venv` 的 transformers 5.17.0，`~/.xinference/virtualenv/...` 只有 124 KB 空壳，
   没走到隔离环境这条路 —— 所以这条是「机制可用」，不是「本次靠它跑通」。

### 对我自己先前结论的一处更正

§附二 结论二 断言 gemma-4 bf16（10.3 GiB）「一定进不了 11 GiB」。**这是错的**：实测在
`nvidia-smi` 报 22528 MiB 的这台机器上，模型完整加载（峰值 11,359 MiB，含 xinference 自身约 1.3 GiB
CUDA 上下文）并完成了一次真实推理。所以真实情况是「**装得下，但几乎没有余量**」：
`max_model_len` 一开大、或再并一个 embedding/rerank，就会顶到上限。这条决定了
`.env` 里 `MAX_MODEL_LEN=30000` 对 gemma-4 是不现实的，本次实测用的是 2048。

### 现在该你点头的那一步（我没有替你做）

把 9997 从旧环境切到新环境 = **重启你正在使用的推理服务**，会打断任何在跑的请求，
所以我停在这里。顺序是：

1. 停掉现在由 backend venv 拉起的 `xinference-local`（pid 687630 / 687633）；
2. 改用 `apps/inference/.venv/bin/xinference-local` 起同样的端口；
3. 首次起会要求建管理员：`POST /v1/admin/setup`，然后 `POST /v1/admin/keys` 发一把 API key；
4. 后端 `.env` 填 `XINFERENCE_API_KEY=<那把 key>`，`scripts/inference_env.sh` 里填
   `XINFERENCE_ADMIN_USER/XINFERENCE_ADMIN_PASSWORD`（launch 才需要 JWT，推理只需要 key）；
5. 再跑 `scripts/load_models.sh` + `scripts/wait_for_models.sh`（两处 `state` 判空已经修好，
   3.x 上现在能正确报 ready）。

如果你暂时不想动 9997，也可以什么都不改：**旧环境唯一的硬伤是它不认 gemma-4 架构**，
把 `XINFERENCE_LLM_MODEL_ID` 换成 2.10 支持的型号（例如 `.env` 里本来就写着的 Qwen3-4B）
就能在不动服务的前提下先用起来。

## 十二、把后端接到真实模型上跑通了（2026-09-29，本轮补）

§十一 证明了「模型能起来」。这一节证明的是「**后端能用它对话**」——这是整条重构线里
一直没能测的那一块（此前本机零模型，`/api/chat` 必然 500）。

做法：一次性 3.5.0 实例（9998，命中缓存权重）+ **独立进程的独立后端**（`:8010`，
只用环境变量覆盖，不改 `.env`、不碰你在用的 `:3000`）。

实测结果：

| 检查 | 结果 |
| --- | --- |
| `POST /api/chat`（mode=llm，带 token） | **SSE 50 行 / 1242 字节**，`data` 形如 `{"type":"token","content":"向量数据库"}`，累计正文 73 字 |
| 回答内容 | 「向量数据库是一种专门用于存储和高效检索高维数据…中**向量嵌入**的数据库系统…」——语义正确 |
| **`user.system_prompt` 是否真的在场** | **是**：回答末尾原样带出了写进个人偏好的暗号 `紫罗兰座机号 7412` |
| 匿名 `POST /api/chat` | **401**（不再是 500） |
| 匿名 `GET /api/llm/references` | **401** |
| 自改 `PATCH /api/user/{自己的 id}` | **200**；改别人的 id → 403 `无权修改该用户`（守卫是对的） |

### 因此修掉的两个真缺陷

1. **`TOKENIZER_ADDR` 指着一个不存在的路径，`/api/chat` 每个请求 500。**
   `.env` 原值 `/home/young/.cache/modelscope/hub/models/qwen/Qwen2.5-3B-Instruct` 在本机
   根本不存在（`~/.cache/modelscope` 整个目录都没有）。`AutoTokenizer.from_pretrained`
   发现路径不是目录后，把这条**绝对路径当 hub repo id** 再校验，抛出
   `HFValidationError: Repo id must be in the form 'repo_name' or 'namespace/repo_name'`
   —— 报错里一个字的 `TOKENIZER_ADDR` 都没提，看起来像 HF/网络问题。
   这与模型、显存、依赖全都无关，是第 4 个独立成因。
   处理：`src/client.py` 的 `get_tokenizer()` 现在对「绝对路径且目录不存在」直接抛
   带配置项名字的错误；`.env` 的默认值改成 repo id `Qwen/Qwen2.5-3B-Instruct`
   （实测在 `HF_ENDPOINT=https://hf-mirror.com` 下可加载，类为 `Qwen2TokenizerFast`，首次联网取一次并缓存）。
   **`.env` 那一行按你的规矩没有进提交**，需要你自己决定要不要单独提交。

2. **`dev.sh` 把四个模型名拼成了一个参数。** 原写法
   `wait_for_models.sh -- "${WAIT_MODELS[*]}"` —— `[*]` 在引号里会 join 成**一个**字符串，
   于是脚本等的是 `"Qwen3-Instruct bge-m3 bge-reranker-base SenseVoiceSmall"` 这个不存在的模型，
   永远不就绪、永远打那句「模型未全部就绪」。改成 `"${WAIT_MODELS[@]}"`。

### 一条日志行的解释要更正

`~/.xinference/logs` 里那条 `'list' object has no attribute 'keys'`，我之前归给
「xinference 2.10 拿不到 model_spec 时走进解析分支」。本轮补了一个更直接的复现：
**用 backend 的 transformers 4.57.6 去加载 gemma-4 的 tokenizer 目录，抛的就是这一模一样的错**。
所以它是「旧 transformers 读不懂新模型的 tokenizer_config」，不是 xinference 的解析 bug ——
这反而更强化 §十一 的结论：服务端必须换到 `apps/inference/.venv`。

### `xinference` CLI 的 launch 也会假绿

同一个 `XINFERENCE_HOME`：CLI `xinference launch …` 打印 `100%` + `Model uid: gemma-4` 且
**exit 0**，但 4 分钟内 `/v1/models` 始终是空的、显纹丝不动（1337 MiB）；
换成 REST `POST /v1/models` 并**显式给 `model_uid`**，服务器日志 12 秒内就出现
`ModelActor(gemma4-e2e-rep0) loaded` / `Launch finished`。
所以 `load_models.sh` 里 CLI 成功只等于「已提交」，真正判就绪必须走 `wait_for_models.sh`
（而它要生效又依赖 §十一 那条 `state` 字段修复）。

### 测试卫生

本轮建的临时账号（id 34/35/36）与其会话/消息已全部经 API 自删，复查库里
`e2e_probe%` 账号数 0、其名下会话 0、全库孤儿消息 0。
**有一处我清不掉**：库里还有一个更早 session 留下的 `qa-anon-probe`（id 27），
我没有它的口令、也不该用你的 root 口令，交给你删。
