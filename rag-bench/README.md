# RAG 准确度与性能基准（rag-bench）

这套东西测的是**应用自己的那条链**，不是另搭一个平行实现：检索走
`POST /api/relation/document/recall`（界面上「命中测试」那块用的同一条路），
问答走 `POST /api/llm/rag`，入库走 `POST /api/relation/document/upload`。
所以这里跑出来的数字就是用户在浏览器里能拿到的数字。

目录里的 `corpus/` 与 `corpus-original/` 已在 `.gitignore` 里：语料是**抓下来的第三方原文**，
不随仓库分发，只存在于这台机器上。重建见 §2 第一步。

---

## 1. 盘上有什么

| 文件 | 内容 |
| --- | --- |
| `corpus/<domain>/<id>.md` | 105 篇已清洗成知识库可吃格式的文档（12 个领域，中英双语） |
| `corpus-original/` | 抓取到的原始正文，用于对照「清洗改了什么」 |
| `MANIFEST.json` / `MANIFEST.md` | 每篇的 id、标题、来源 URL、领域、语言、质量档、正文信号量 |
| `TRIMMING.md` | 长文裁剪的依据与前后对比（为什么要裁） |
| `queries.jsonl` | 355 条带金标的查询：`unique` 275 / `multi` 24 / `hand` 16 / `unanswerable` 40 |
| `queries.md` | 同一批查询的人读版，**手动测试时照着念就行** |
| `ingest_map.json` | 语料 id → 服务器返回的 `doc_id` / `title`（标题就是文件名） |
| `ingest_fails.json` | 入库失败清单（本轮为空） |
| `results.json` | 检索层每条查询的原始命中 + 汇总（三层对比） |
| `report.md` | 检索层报告：总体、分领域、分语言、分质量档、阈值判别、最差 20 条 |
| `e2e.json` / `e2e.out` | 端到端问答结果（引用命中、证据是否进答案、无据作答率、延迟） |
| `calibrate.out` | `MIN_RELEVANCE_SCORE` 标定输出 |
| `ACCOUNT` | 一次性基准账号口令（不入库、不提交） |

脚本职责单一，按顺序串起来就是整条流水线：

```
build_corpus.py     抓取 + 规范化 → corpus/ + MANIFEST.json
trim_corpus.py      按预算裁长文 → 改写 corpus/，理由写进 TRIMMING.md
gen_queries.py      从正文里取「全库唯一」的片段造查询 + 金标 → queries.jsonl
ingest.py           逐篇 POST /api/relation/document/upload → ingest_map.json
eval_retrieval.py   只测召回，不调模型 → results.json / report.md
calibrate_threshold.py  量 rerank 分数分布，给阈值定标 → calibrate.out
eval_end_to_end.py  测「检索到了有没有用好」→ e2e.json
```

语料构成（`MANIFEST.json` 实测）：protocol 9、web-docs 14、programming 8、cloud-native 11、
public-health 7、databases 8、web-standards 3、security 3、literature 7、biomed 6、
research 21、noisy 8；质量档 high 33 / mid 57 / low 15；语言 en 74 / zh 31。
`noisy/` 是**故意**放进去的低质量文档（OCR 味、表格拍平、复制粘贴残骸），
用来 answers「垃圾进去会不会把整个库拖垮」，不是凑数。

---

## 2. 跑一遍要多久，按什么顺序

前置：Postgres / Redis / Milvus 就绪，后端在 `:3000`，xinference 在 `:9997`
且 **LLM + embedding 两个模型都在跑**（rerank 可缺，缺了就只能跑不开重排的那几档）。
统一用后端环境里的解释器，别用 `uv run`（它会重解析依赖，撞上代理 403）：

```bash
cd /home/young/Ametrine
PY=/home/young/Ametrine/apps/backend/.venv/bin/python
```

### 2.1 已经抓好的话，跳过这两步

```bash
$PY -u rag-bench/build_corpus.py           # 联网抓取，约 4 分钟（Gutenberg/arXiv/RFC 会重试）
$PY -u rag-bench/trim_corpus.py            # 裁长文；只在正文超过预算时动手
$PY -u rag-bench/gen_queries.py --per-doc 3
```

`build_corpus.py` 可重跑：已存在的文件默认跳过，`--force` 才覆盖。抓取失败**不会**留下半成品
（先写临时文件，成功才改名），所以 `MANIFEST.json` 里不会混进空文档。

### 2.2 入库（105 篇，一次约 12 分钟）

```bash
PW="$(cat rag-bench/ACCOUNT)"
$PY -u rag-bench/ingest.py --password "$PW" 2>&1 | tee rag-bench/ingest.out
```

**幂等性说明（重要，别踩）**：这个库不是「重跑一次就当没跑过」。`ingest.py` 会在开始时
拿服务器端的文档列表对账（按标题=文件名），已经在库里的直接跳过，所以重复运行是安全的、
也是续跑的正确方式；但它不会更新已经入库的那篇。改了 `corpus/` 想重来，
就先把集合里的旧文档删掉（界面上删，或 `DELETE /api/relation/document/{document_id}`）。

账号是 `ragbench`（口令在 `ACCOUNT` 里），它同时是这 105 篇的上传者。

### 2.3 检索层（不花推理配额，约 3 分钟一轮）

```bash
$PY -u rag-bench/eval_retrieval.py --password "$PW" --modes raw,vector,rerank
```

产物 `results.json`（每条查询的命中名次，可复核）和 `report.md`。三层含义：

- `raw` —— `/vector/document/search` 的原始候选，top_k=10 真的给 10 条；
- `vector` —— 应用真正的召回路径（关重排），受 K/P 截断，**这才是进 prompt 的那批**；
- `rerank` —— 同一条路开重排，于是还要过 `MIN_RELEVANCE_SCORE`。

`raw` 与 `vector` 的差 = 截断吃掉的可召回量；`vector` 与 `rerank` 的差 = 重排 + 阈值吃掉的量。
分领域、分语言、分质量档的拆分都在 `report.md`，不用重新跑。

### 2.4 阈值标定

```bash
# 进程内直连（不经过 HTTP，所以不需要账号口令；但要 PG / Milvus / xinference 都在跑）
cd rag-bench && ../apps/backend/.venv/bin/python -W ignore -u calibrate_threshold.py
```

它把 gold 命中块的 rerank 分数分布量出来，回答「现在的阈值该是多少」。
**2026-10-01 跑通了**（前一版记录里它被 `bge-reranker-base` 加载失败挡着，
`CrossEncoder.__init__() got an unexpected keyword argument 'address'`；
现在这台机器上那个模型确实能出分，`scripts/doctor.py --live` 就是用来区分「注册表里有」和「真能打」的）。

120 条金标查询、255 个金标块 / 945 个非金标块：

| 阈值 | 金标保留 | 噪声通过 | 结果为「零引用」的查询比例 |
| --- | --- | --- | --- |
| 0.001 | 0.796 | 0.221 | 0.200 |
| 0.003 | 0.702 | 0.108 | 0.300 |
| **0.005** | **0.675** | **0.089** | **0.317** |
| 0.01 | 0.620 | 0.068 | 0.358 |
| 0.05 | 0.467 | 0.022 | 0.467 |
| 0.1 | 0.396 | 0.015 | 0.508 |
| 0.2 | 0.333 | 0.010 | 0.583 |
| **0.30（当时的配置）** | 0.286 | 0.005 | 0.650 |

金标分数中位 **0.0397**。同一批候选、**不看阈值**只比排序：

| 排序 | hit@1 | hit@3 | MRR |
| --- | --- | --- | --- |
| vector | 0.4667 | 0.5417 | 0.5145 |
| rerank | **0.5333** | **0.5833** | **0.5635** |

⇒ **重排模型不是问题，绝对阈值才是**。这条是对上一轮结论的更正：
之前记录的「rerank 模式 hit@1 从 0.44 掉到 0.22」是把阈值的砍与排序的质量混在一起量的。
原始输出留在 `calibrate.out`，聚合值在 `threshold.json`。

### 2.5 端到端

```bash
$PY -u rag-bench/eval_end_to_end.py --password '<同上>' --n 24
```

跑之前会先打一发自检（「1 加 1 等于几」）：**模型吐不出内容时直接退出码 2 停下**，
不再把 26 条废数据写成结果。这一点是踩过坑加的 —— 上一轮 26 条里 16 条是
「HTTP 200 + 零 token」，指标全被读成「模型答不上来」，真因是 gemma worker 触发了
CUDA device-side assert 并进入 sticky 错误状态。

---

## 3. 多格式真实语料（`formats/`）

**一条命令跑完整层**（它会自己起/关对照实例 `SEMANTIC_SPLITTER=false`）：

```bash
bash rag-bench/run_formats_pipeline.sh
```

下面这几条是它内部按顺序做的事，逐步手跑时用它们（每步都要 `export
AMETRINE_BENCH_BASE=http://127.0.0.1:3010/api`，否则默认打 :3000 的语义切分实例）：

上面那 105 篇全是 `.md`，也就是说 `LOADER_MAPPING` 的 14 个扩展名里只有 1 个走过完整链路。
`formats/` 是专门为此补的一轮：**每种扩展名都用出版方自己托管的真实文件**。

```bash
PW="\$(cat rag-bench/ACCOUNT)"            # 见 §6 的坑：这里的 $(...) 必须由 WSL 求值
$PY -u rag-bench/probe_formats.py                        # 发现候选 + 逐条验容器魔数
$PY -u rag-bench/build_formats_corpus.py                 # 下载 + 容器校验 + formats/MANIFEST.json
$PY -u rag-bench/ingest.py --password "$PW" --manifest formats/MANIFEST.json \
    --database ragbench_fmt --collection ragbench_formats \
    --map-out ingest_formats_map.json --fails-out ingest_formats_fails.json \
    --skip-format epub --max-bytes 1500000
$PY -u rag-bench/formats_fidelity.py --password "$PW"     # 内容到底还剩多少进了知识库
$PY -u rag-bench/gen_format_queries.py --password "$PW"   # 金标取自索引文本 ⇒ 题一定答得出
$PY -u rag-bench/eval_retrieval.py --password "$PW" --queries formats-queries.jsonl \
    --map ingest_formats_map.json --database ragbench_fmt --collection ragbench_formats \
    --out formats-results.json --report formats-report.md
```

真实出处（可在 `formats/MANIFEST.json` 里逐条核对 sha256 与 URL）：
arXiv、RFC Editor、NIST、Project Gutenberg、GeoNames、NOAA NCEI、World Bank、
加拿大开放数据（open.canada.ca，出版方托管的 .docx/.xlsx/.pptx）、
魁北克与新西兰政府门户，以及 Apache SpamAssassin 公开邮件语料（真实邮件，按它自己的分隔符拆成单封）。

**三份清单，别混着读**：

| 字段 | 含义 |
| --- | --- |
| `container: publisher-native` | 出版方就是以这个容器发布的（真 .pptx、真 .xlsx、真 .doc） |
| `container: split-from-publisher-archive` | 出版方归档里的原始对象（邮件），我按官方分隔符拆开，内容未改 |
| `container: locally-wrapped(real-content)` | 容器由本地生成，正文取自上一轮已验出处的真实文档 —— 只用来覆盖解析路径，**不代表有人这么发布** |

`formats-coverage.md` 会写清每种格式拿到几份、缺谁。`.ppt` 是唯一一份真实原件都没拿到的格式，
脚本在这种情况下**非零退出**，所以「覆盖 14 种」这句话永远是数出来的，不是猜的。

---

## 4. 手动测试（不想跑脚本的时候）

1. 用 `ragbench` 登录（口令见 `ACCOUNT`），或用自己账号——但那 105 篇归 `ragbench`，
   需要在知识库页把它共享给你的租户才能读到。
2. 知识库选 **`ragbench2026`**，集合选 **`ragbench_all`**。
   （`ingest.py --by-domain` 会按领域各建一个 `ragbench_<domain>` 集合，本轮没用它，
   所以现在盘上只有 `ragbench_all` 一个集合。）
3. 从 `queries.md` 里挑一条念进对话框。每条都带着它的金标文档，格式是
   「问题 ← 应该命中的文件」，答案里引用卡片指向的文件名 = `ingest_map.json` 里的 `title`。
4. 只想看检索不想看回答，用知识库页的**命中测试**面板：它和 `eval_retrieval.py` 打的是同一个接口，
   所以界面里的排名和 `results.json` 里的名次应当一致 —— 不一致本身就是 bug，值得记下来。
5. 想复现「答案质量」那一层的两档对比，同一条问题各跑一遍：开重排、关重排。
   按当时的配置（阈值 0.3），**开重排更容易得到「没有参考信息」的回答**——原因见 §5 第 1 条；
   把 `MIN_RELEVANCE_SCORE` 改成 0.005 再重启后端，这一档差别就基本消失了
   （重排的排序本来优于纯向量：hit@1 0.533 vs 0.467）。

---

## 5. 本轮量出来的结论（可复核，别当意见读）

检索层（355 条 / 315 条可回答 / top_k=10）：

| 层 | hit@1 | hit@3 | hit@10 | MRR | nDCG@10 | 有命中比例 |
| --- | --- | --- | --- | --- | --- | --- |
| raw | 0.4317 | 0.5143 | 0.6159 | 0.4857 | 0.5029 | 0.6159 |
| vector | 0.4444 | 0.5302 | 0.5302 | 0.4820 | 0.4767 | 0.5302 |
| rerank | 0.2159 | 0.2254 | 0.2254 | 0.2206 | 0.2195 | 0.2254 |

两个产品缺陷是被这组数字逼出来的，不是猜的：

1. **`MIN_RELEVANCE_SCORE=0.3` 对 bge-reranker 的分数尺度是错的**（现已在 `.env.example` 改成 0.005）。
   开重排时 **276/355** 条查询拿到 0 条引用，rerank 把 `found` 从 0.5302 砍到 0.2254。
   2026-10-01 用 §2.4 的脚本把分布完整量过了（120 条查询 / 255 金标块 / 945 干扰块）：
   金标中位 **0.0397**，0.3 处只剩 **28.6%** 的金标块活着、**65%** 的查询变成零引用；
   0.005 处金标保留 **67.5%**、噪声通过 8.9%。
   更早那份「n=49、中位 0.012」是同一件事的小样本预览，方向一致、数值以 §2.4 的表为准。
   **并且要更正一条本轮早期的错误归因**：`rerank` 模式 hit@1 从 0.44 掉到 0.22 一度被写成
   「重排把检索弄差了」；把阈值摘掉只看排序，重排是**赢**纯向量的（0.533 vs 0.467、MRR 0.564 vs 0.515）。
   损失全部来自那一道绝对阈值，不来自模型。
   结构上的成因是：这个开关只会单向起作用 —— 进上下文的条数由 `P` 封顶，
   阈值往下砍不会让回答更稳，只会把已经排好序的依据砍成零。
   后果不是「排序差一点」，是**用户开了重排就大面积看到「没有参考信息」**，
   而界面上那个开关看起来是个提升质量的选项。
2. **`top_k` 是装饰**。`.env` 里 `K=5`、`P=3`，`unify_filter` 最后按 `p` 截断，
   所以界面上把 top_k 调到 10、20，真正进 prompt 的块数恒 ≤3。
   `raw`→`vector` 那 0.6159→0.5302 的差就是这一刀。

端到端（24 条分层样本，重排关，`top_k=10`，金丝雀通过后跑的完整一轮）：

| 指标 | 值 |
| --- | --- |
| 引用里含金标文档 | **0.50**（22 条可判） |
| 无据仍作答 | **0.50** |
| 金标进引用时标了出处 | 0.727（11） |
| 金标没进引用时标了出处 | 0.200（10） |
| 首字延迟 | 中位 2.81 s |
| 整条回答 | 中位 20.84 s / 最大 72 s |
| 空回答 / 流错误 / HTTP 错误 | 0 / 0 / 0 |

两个读数要放在一起看：**一半的回答，依据里没有那篇该找的文档，而回答照样流畅完整**；
模型唯一的自我暴露是出处标记率（有据 72.7%、无据 20%）。
`引用含金标 0.50` 与检索层 `found=0.5302` 相互对齐 —— 两条独立链路给出同一个数，
这既是交叉验证，也说明端到端这层没有额外的损失，问题全在召回与阈值上。

⚠ `答案含证据片段` 这条指标**不要用**：`unique` 类的题面本来就含着那个片段（`In which context is X mentioned…`），
21/21 条可判样本的片段都出现在问题原文里，命中很可能只是复述。
脚本已经把 `span_in_query` 记进每行并单列一条「题面未含该片段」的干净率，重跑之后看那条。

延迟侧（检索层，355 条串行）：`raw` 中位 73 ms / p95 307 ms，`vector` 中位 68 ms / p95 300 ms，
`rerank` 中位 293 ms / p95 753 ms —— 开重排把检索耗时乘了约 4 倍，
同时把可回答题的引用命中率从 0.53 砍到 0.23：**多花 4 倍时间、少拿一半依据**。

### 多格式这一层（§3 的产物）

入库结果（真实文件，逐个走 `POST /relation/document/upload`）：

| 结果 | 扩展名 |
| --- | --- |
| 成功 | `.md` `.markdown` `.txt` `.csv` `.docx` `.xlsx` `.pptx` `.odt`(2/4) `.html`(2/3) `.eml` |
| 501 缺依赖（文案诚实，未写入任何数据） | `.doc`（要 LibreOffice） `.pdf`（要 unstructured-inference） |
| 超 900 秒没完成 | `.epub`（整本书，见下） |
| 没拿到真实原件 | `.ppt` |

保真度（另一套解析器取参考正文，与应用存回来的分块比对）：
`.md/.markdown/.txt/.csv/.docx/.xlsx/.odt` **1.000**，`.pptx` 0.972，`.html` **0.795**，
`.eml` **0.631** —— `.eml` 丢的是**信封**（`From/To/Date` 没进索引，只有正文与 `Subject:`），
所以「按发件人找邮件」这类问题现在必然查不到。

检索（40 条金标取自索引文本的题）：`raw` 与 `vector` 同为 hit@1 0.375 / found 0.425 / MRR 0.3958。
比 `.md` 语料低约三分之一 —— 但这个库里块形态混杂（一格一块的 xlsx、一句一块的 pptx），
所以这条只当「格式一多会掉」的观察，不当结论。

四个被这一轮逼出来的实现缺陷（详见交接文档 §15.5）：语义切分**每句话请求一次向量**
（1,592 字符耗时 10.69 s，定长切分 <0.01 s）⇒ 整本书进不来；`SEMANTIC_SPLITTER=true` 时
`CHUNK_SIZE` 完全不参与（实测切出 1,409 字的块）；上传被客户端取消会在盘上留下删不掉的孤儿原文
（`CancelledError` 是 `BaseException`，绕过了清理分支）；集合名是**全局唯一**而上传只按名字解析集合
⇒ PG 行与向量可以落到两个不同的库里（已加归属 409 校验，双向验过）。

另外三条是实现缺陷，不是度量问题，本轮已修：

- 入库路径把解析+向量化跑在事件循环里：单文档 30 秒级的同步块会占住整个 worker，
  并发上传直接串台。已改为 `anyio.to_thread`。
- 生成中断以前对用户不可见：`StreamingResponse` 的 200 头先发出去了，上游异常逃出流生成器时
  浏览器只会拿到「成功的空回答」。现在流里会带一条错误事件（含错误编号，原文只进服务端日志），
  前端认得它并把这条回答记成失败。自检脚本里加了能变红的守卫（去掉修复它就会失败）。
- 检索的引用条目里没有 `doc_id`，只有 `title`/`source`。任何拿 `doc_id` 比对引用的做法都会
  静默得到「引用全错」—— 本轮第一版就栽在这里，`eval_end_to_end.py` 现在按 `title` 比。

---

### 分块器在 v0.3.0 换了实现，两批数据的形状不一样

库里旧文档保持它被索引时的切分方式（重建才有新形状），所以这份基准里同时存在两种形状，
别把它们当成同一件事：

| 集合 | 怎么切的 | 块数 | 最长块 | 超过配置的 512 |
| --- | --- | --- | --- | --- |
| `ragbench_all` | 旧 `SemanticChunker`（按句请求向量、`CHUNK_SIZE` 不参与） | 1,533 | **23,972** | 477 块（31.1%） |
| `ragbench_formats` | 同上 | 3,495 | 22,248 | 大量 |
| `ragbench_fastfmt` | `SEMANTIC_SPLITTER=false` 定长 | 6,226 | 511 | 0 |
| `ragbench_split` | 新 `BoundedChunker`（本轮重传） | 56 + 1,400 | **512** | **0** |

`ragbench_split` 里那 56 块就是 `ragbench_all` 里的同一篇 `mdn-webapi-zh.md`（旧的是 2 块、最长 23,972），
留着它就是为了这个对照随时可以复量；同集合里还有那本 EPUB（356 KB → 1,400 块，554 s，
上一轮在这条路上 >900 s 一次都没落库）。

## 6. 环境陷阱（跑不动先查这几条）

- **代理**。登录 shell 带 `HTTP_PROXY=http://127.0.0.1:7897`，`curl` 打本机请一律加 `--noproxy '*'`，
  否则 403/超时都是代理的锅不是应用的。抓语料时同理（脚本内部已处理索引域名）。
- **`$?` 在这条链路上不可信**（Git Bash → wsl.exe 会把退出码吃掉）。判断成败请用
  `if cmd; then …; else …; fi` 或看脚本自己打的汇总行。
- **模型 uid 不是进程名**。xinference 的 `/v1/models` 条目里 uid 在 `id` 字段（本轮是 `gemma-4`），
  而 worker 进程标题是 `gemma-4-rep0` —— 拿后者去 `DELETE /v1/models/<uid>` 会得到
  「Model not found in the model list」。
- **sticky CUDA 错误**。一旦 `CUDA error: device-side assert triggered`，那个 worker 之后每个请求都会失败，
  且失败是「静默的空回答」（修复后变成流内错误事件）。恢复办法：把这个模型卸掉再装
  （管理台的「模型推理」页，或 `DELETE /v1/models/gemma-4` + `bash scripts/load_models.sh apps/backend`）。
  **别去动 `:9997` 服务本身**，它上面还挂着 embedding。
- **`$(...)` 在 `wsl.exe -d Ubuntu bash -lc '…'` 里是被外层 Git Bash 求值的，不是 WSL。**
  哪怕整条命令都用单引号包住也一样。所以 `--password "$(cat rag-bench/ACCOUNT)"` 只有在外层
  cwd 恰好能看到那个文件时才有值；换到别的目录就**静默变成空串**，
  表现是 `POST /api/auth` 回 422 `body.password Field required` —— 看着像服务端 bug，其实是脚本。
  要 WSL 求值就写 `\$(...)`，或者直接传字面量。
- **上传被客户端取消会留下孤儿原文。** `asyncio.CancelledError` 自 3.8 起是 `BaseException`，
  所以路由里那批 `except Exception` 的清理分支一条都不执行。现已补 `except BaseException` 收口，
  门是 `scripts/selfcheck_upload_cancel.py`（它会轮询盘上「出现过又消失」，
  因为只比对前后目录的话，「被清理」与「压根没到那一步」读起来一模一样）。
- **口令里的 `!`**。Git Bash 会把它变成 `\!`，注册账号时写进去就成了「设了 A 登录要用 B」。
  本轮账号口令因此特意不含 `!`。

## 7. 收尾

基准账号和它的 105 篇是本地一次性资产。真要清理：
用应用自己的 `DELETE /api/user/delete?user_id=<ragbench>`（级联清掉文档与集合），
不要裸删 SQL；集合/库需要显式确认才会删（`/api/vector/database/reset` 会连 `tenant` 一起删，
在任何情况下都不要碰它）。
