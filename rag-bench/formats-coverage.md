# 多格式真实语料覆盖度

目标：应用白名单的 14 个扩展名，每种最多 4 份真实文件。

| 格式 | 份数 | 容器原件? | 出版方 | 字节范围 |
| --- | --- | --- | --- | --- |
| `.csv` | 2 | publisher-native | www.ncei.noaa.gov | 1,704–4,042 |
| `.doc` | 2 | publisher-native | Canadian Radio-television and Telecommunications Commission | Conseil de la radiodiffusion et des télécommunications canadiennes | 72,704–133,120 |
| `.docx` | 4 | locally-wrapped(real-content)、publisher-native | Department of Customer Service / 容器本地生成，正文取自上一轮已验出处的真实文档 | 37,267–65,801 |
| `.eml` | 4 | split-from-publisher-archive | Apache SpamAssassin public corpus | 3,376–5,216 |
| `.epub` | 3 | publisher-native | www.gutenberg.org | 356,059–726,981 |
| `.html` | 3 | publisher-native | www.postgresql.org / www.rfc-editor.org / www.w3.org | 118,048–1,711,644 |
| `.markdown` | 1 | locally-wrapped | IETF RFC Editor | 22,271–22,271 |
| `.md` | 1 | locally-wrapped | IETF RFC Editor | 4,723–4,723 |
| `.odt` | 4 | locally-wrapped(real-content)、publisher-native | Veterans Affairs Canada | Anciens Combattants Canada / 容器本地生成，正文取自上一轮已验出处的真实文档 | 1,934–11,932 |
| `.pdf` | 3 | publisher-native | export.arxiv.org / nvlpubs.nist.gov / www.rfc-editor.org | 1,480,377–2,858,365 |
| `.ppt` | 0 | - | - | - |
| `.pptx` | 4 | publisher-native | Public Services and Procurement Canada | Services publics et Approvisionnement Canada | 1,038,195–1,428,991 |
| `.txt` | 2 | publisher-native | download.geonames.org / www.gutenberg.org | 31,678–448,885 |
| `.xlsx` | 4 | publisher-native | Employment and Social Development Canada | Emploi et Développement social Canada / Natural Resources Canada | Ressources naturelles Canada | 14,741–71,964 |

**没拿到真实文件的格式**：`.ppt`
**被容器校验挡下的候选**：2 条（清单在 MANIFEST 的 skipped_candidates 里）
