# 多格式入库保真度

参考正文由本地另一套解析器取出，再和应用存回来的分块比对。
`unit_coverage` = 该格式的自然单位（段落/行/页/表行）里，有多少能在索引文本中找到。

| 格式 | 份数 | 入库成功 | 平均块数 | 平均单位覆盖率 | 平均索引字数 | 抽取手段 |
| --- | --- | --- | --- | --- | --- | --- |
| `.csv` | 2 | 2 | 75.5 | 1.0 | 4368 | csv 模块（61 行） |
| `.doc` | 2 | 0 | - | - | - | — |
| `.docx` | 4 | 4 | 22.5 | 1.0 | 9249 | python-docx（8 段 / 2 表） |
| `.eml` | 4 | 4 | 3.8 | 0.631 | 1395 | email 模块（头字段 + 正文段） |
| `.epub` | 3 | 0 | - | - | - | — |
| `.html` | 3 | 2 | 198.0 | 0.795 | 72503 | bs4 去脚本/导航后的正文 |
| `.markdown` | 1 | 1 | 63.0 | 1.0 | 20091 | 直接读文本 |
| `.md` | 1 | 1 | 12.0 | 1.0 | 4143 | 直接读文本 |
| `.odt` | 4 | 2 | 3.0 | 1.0 | 1288 | content.xml 的 text:p |
| `.pdf` | 3 | 0 | - | - | - | — |
| `.pptx` | 4 | 4 | 7.5 | 0.972 | 3292 | python-pptx（10 页） |
| `.txt` | 2 | 2 | 637.0 | 1.0 | 235754 | 直接读文本 |
| `.xlsx` | 4 | 4 | 52.5 | 1.0 | 26147 | openpyxl（1 表 / 60 行） |

**没拿到分块的文档**：11 份

- `.doc` fmt-doc-01-data-20dictionary.doc：没有入库映射
- `.doc` fmt-doc-02-dictionnaire-20de-20don：没有入库映射
- `.epub` fmt-epub-01-pg2701.epub：没有入库映射
- `.epub` fmt-epub-02-1342.epub.noimages：没有入库映射
- `.epub` fmt-epub-03-84.epub.noimages：没有入库映射
- `.html` fmt-html-03-web-authentication-an-：没有入库映射
- `.odt` fmt-odt-01-data_dictionary_perform：没有入库映射
- `.odt` fmt-odt-02-wtt-odta-dd.odt：没有入库映射
- `.pdf` fmt-pdf-01-1706.03762：没有入库映射
- `.pdf` fmt-pdf-02-rfc9110.pdf：没有入库映射
- `.pdf` fmt-pdf-03-nist.sp.800-63b.pdf：没有入库映射

**覆盖率低于 0.6 的（内容在里面却查不到的那一类）**

| 格式 | 文档 | 覆盖率 | 块数 | 索引字数 | 单位数 |
| --- | --- | --- | --- | --- | --- |
| `.eml` | fmt-eml-03-zzzzteana-moscow-bo | 0.5 | 5 | 1,859 | 8 |
| `.eml` | fmt-eml-02-zzzzteana-re-alexan | 0.556 | 2 | 881 | 9 |
