#!/usr/bin/env python
"""给 .csv 换一份**真有数值**的真实文件，再走一遍完整的下载/校验/入库路径。

为什么不是直接改文件：`formats-candidates.json` 是发现阶段的缓存，
真正决定「这份文件算不算数」的是下载之后的容器校验；所以这里只往缓存里补候选，
剩下的仍由 build_formats_corpus.py 逐条验魔数与结构 —— 不绕过那一道。

上一个 NOAA 端点选的是 TAVG（年平均温度），拉沃瓜第机场站在 2024-01 那 60 行里
**整列都是空的**（真实数据里就有这种情况），于是「按一行 CSV 检索」这个用例
其实没有内容可检索，测出来的差也不能算在系统头上。
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (X11; Linux x86_64) Ametrine-rag-bench/1 (document format research)"

NEW_CSV = {
    "url": ("https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries"
            "&stations=USW00094728&dataTypes=TMAX,TMIN,PRCP"
            "&startDate=2024-01-01&endDate=2024-03-31&format=csv&units=standard"),
    "type": "text/csv",
    "magic": "2253544154494f4e",
    "provenance": {"container": "publisher-native", "package": "", "organization": "www.ncei.noaa.gov"},
}


def main() -> int:
    cache = ROOT / "formats-candidates.json"
    cands = json.loads(cache.read_text(encoding="utf-8"))
    if not any(NEW_CSV["url"] == c.get("url") for c in cands.get(".csv", [])):
        cands.setdefault(".csv", []).append(NEW_CSV)
        cache.write_text(json.dumps(cands, ensure_ascii=False, indent=2), encoding="utf-8")
        print("已把带数值的 NOAA CSV 加进候选缓存")
    else:
        print("候选里已有这条")

    # 先确认这个端点真的有非空数值，别又拿一列空值去测
    req = urllib.request.Request(NEW_CSV["url"], headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode("utf-8", "replace")
    lines = [l for l in text.splitlines() if l.strip()]
    filled = sum(1 for l in lines[1:] if len([c for c in l.split(",")[1:] if c.strip()]) >= 2)
    print(f"NOAA 新行 {len(lines)-1} 行，其中至少两列有值的 {filled} 行")
    if filled < 20:
        print("✗ 这份 CSV 的数值列仍然太空，不值得入库")
        return 1
    print("首行样本:", lines[0][:60], "|", (lines[1][:60] if len(lines) > 1 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
