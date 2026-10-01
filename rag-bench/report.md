# RAG 检索准确度报告

库 `ragbench_fast` / 集合 `ragbench_fastfmt`，top_k=10，查询 40 条（剔除 0 条金标签不匹配的），错误 0 次。

## 模式：raw

| 指标 | 值 |
|---|---|
| n_answerable | 40 |
| hit@1 | 0.375 |
| hit@3 | 0.425 |
| hit@5 | 0.425 |
| hit@10 | 0.425 |
| recall@5 | 0.425 |
| recall@10 | 0.425 |
| MRR | 0.3958 |
| ndcg@10 | 0.4033 |
| found_rate | 0.425 |
| median_rank_1based | 1 |
| 延迟中位 / p95 (ms) | 106 / 592 |

## 模式：vector

| 指标 | 值 |
|---|---|
| n_answerable | 40 |
| hit@1 | 0.375 |
| hit@3 | 0.425 |
| hit@5 | 0.425 |
| hit@10 | 0.425 |
| recall@5 | 0.425 |
| recall@10 | 0.425 |
| MRR | 0.3958 |
| ndcg@10 | 0.4033 |
| found_rate | 0.425 |
| median_rank_1based | 1 |
| 延迟中位 / p95 (ms) | 102 / 432 |

## 分领域（各模式 hit@5 / MRR）

| 领域 | 条数 | raw hit@5 / MRR | vector hit@5 / MRR |
|---|---|---|---|
| docx | 3 | 0.0 / 0.0 | 0.0 / 0.0 |
| eml | 5 | 0.4 / 0.4 | 0.4 / 0.4 |
| html | 6 | 1.0 / 0.9167 | 1.0 / 0.9167 |
| markdown | 3 | 0.6667 / 0.6667 | 0.6667 / 0.6667 |
| md | 1 | 1.0 / 1.0 | 1.0 / 1.0 |
| pptx | 7 | 0.0 / 0.0 | 0.0 / 0.0 |
| txt | 6 | 0.3333 / 0.3333 | 0.3333 / 0.3333 |
| xlsx | 9 | 0.4444 / 0.3704 | 0.4444 / 0.3704 |

## 不可回答样本：分数分布（阈值能不能把它和真问题分开）


## 最差的 20 条（排在最远或根本没召回）

| id | 领域 | 档 | 查询 | 首次命中位次 |
|---|---|---|---|---|
| f0032 | xlsx | publisher-native | Explain the role of transportation-alternativ in this docume | 2 |
| f0010 | html | publisher-native | Explain the role of whitespace-preceded in this document. | 1 |
| f0005 | eml | split-from-publisher-archive | Explain the role of deepeddy.vircio.com in this document. | 0 |
| f0006 | eml | split-from-publisher-archive | Explain the role of fuchsia.cs.mu.OZ.AU in this document. | 0 |
| f0009 | html | publisher-native | What does the document say about whitespace-delimited? | 0 |
| f0011 | html | publisher-native | What does the document say about message-forwarding? | 0 |
| f0012 | html | publisher-native | What does the document say about search_seq_col_name? | 0 |
| f0013 | html | publisher-native | Explain the role of cycle_mark_col_name in this document. | 0 |
| f0014 | html | publisher-native | What does the document say about cycle_path_col_name? | 0 |
| f0016 | markdown | locally-wrapped | What does the document say about inter-enterprise? | 0 |
| f0017 | markdown | locally-wrapped | What does the document say about GeertJan.deGroot? | 0 |
| f0018 | md | locally-wrapped | What does the document say about harvard.edu? | 0 |
| f0028 | txt | publisher-native | What does the document say about twenty-eight? | 0 |
| f0029 | txt | publisher-native | In which context is xk-country-code-for-kosov mentioned, and | 0 |
| f0034 | xlsx | publisher-native | Explain the role of understanding-the-tables in this documen | 0 |
| f0037 | xlsx | publisher-native | In which context is ansports-carburants-rempl mentioned, and | 0 |
| f0038 | xlsx | publisher-native | What does the document say about Top-Up? | 0 |
| f0001 | docx | publisher-native | What does the document say about E-Micromobility? | None |
| f0002 | docx | publisher-native | In which context is Lithium-Ion mentioned, and what is state | None |
| f0003 | docx | publisher-native | In which context is Hawkesbury-Nepean mentioned, and what is | None |
