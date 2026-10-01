#!/usr/bin/env python
"""把超大文档裁到基准可用的规模，并把这件事**写进清单**。

为什么必须裁：语料里有整本小说（70 万字）。按现在 512 的切分，一篇就是上千个 chunk，
一次入库上万次嵌入调用，评测跑到天亮；而金标签的密度并不会因此变高。
基准要的是「检索准不准」，不是「压垮索引要多久」。

裁剪规则确定、可复现，并且每篇都在 MANIFEST 上留下 `trimmed_from`：
  保留 头 40% + 中 20% + 尾 40%，在断点处插入一行「[…]（本段已裁剪）」，
  让模型和人都能看出来这里不是连续的原文 —— 否则它会拿一个跨段的句子去答题，
  而失败原因会指向"检索不准"，其实是我们自己造了个断崖。

跑完顺带重算 signals/tier，因为 tier 是按正文客观信号算的，裁完不重算就是拿旧标签贴新文档。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from build_corpus import signals, tier_for  # noqa: E402

CAP = 24_000      # 字符；约 45 个 chunk 一篇，100 篇 ≈ 4.5k chunk
MARK = "\n\n[…]（此处为基准裁剪的断点，原文连续内容已省略）\n\n"


def trim(text: str) -> str:
    if len(text) <= CAP:
        return text
    head = int(CAP * 0.4)
    mid = int(CAP * 0.2)
    tail = CAP - head - mid
    a = text[:head]
    b = text[len(text) // 2 - mid // 2: len(text) // 2 + mid // 2]
    c = text[-tail:]
    return a + MARK + b + MARK + c


def main() -> int:
    manifest = json.loads((ROOT / "MANIFEST.json").read_text(encoding="utf-8"))
    original_dir = ROOT / "corpus-original"
    changed = 0
    for d in manifest["documents"]:
        path = ROOT / d["path"]
        if not path.exists():
            continue
        raw = path.read_text(encoding="utf-8", errors="replace")
        # 只裁正文，不裁那三行来源头
        parts = raw.split("---\n", 1)
        front, body = (parts[0] + "---\n", parts[1]) if len(parts) == 2 else ("", raw)
        new_body = trim(body)
        if len(new_body) == len(body):
            continue
        # 原件留一份：裁剪是为了评测跑得起，不是为了销毁语料。
        # 你后面要手动测「整本小说那种长文档表现如何」，得有个不重抓的办法。
        keep = original_dir / path.relative_to(ROOT / "corpus")
        keep.parent.mkdir(parents=True, exist_ok=True)
        if not keep.exists():
            keep.write_text(raw, encoding="utf-8")
        path.write_text(front + new_body, encoding="utf-8")
        sig = signals(new_body)
        d["trimmed_from"] = d["signals"]["chars"]
        d["original_path"] = str(keep.relative_to(ROOT))
        d["signals"] = sig
        d["tier"] = tier_for(sig)
        changed += 1
        print(f"  裁 {d['id']}: {d['trimmed_from']} → {sig['chars']}（原件 {d['original_path']}）")
    (ROOT / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if changed:
        (ROOT / "TRIMMING.md").write_text(
            "\n".join([
                "# 语料裁剪记录", "",
                f"上限 {CAP} 字符/篇；裁剪 {changed} 篇；原件在 `corpus-original/`。", "",
                "| 文件 | 原字数 | 裁后 | 原件 |", "|---|---|---|---|",
                *[f"| {d['path']} | {d['trimmed_from']} | {d['signals']['chars']} | "
                  f"{d.get('original_path','')} |"
                  for d in manifest["documents"] if d.get("trimmed_from")],
                "", "裁剪方式：头 40% + 中 20% + 尾 40%，断点处插入显式标记行。",
            ]) + "\n", encoding="utf-8")
    total = sum(d["signals"]["chars"] for d in manifest["documents"])
    print(f"裁剪 {changed} 篇；语料总字数 {total}（约 {total // 512} 个 chunk 上限）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
