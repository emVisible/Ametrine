#!/usr/bin/env python
"""入库分块器的**进程内**门：钉住「CHUNK_SIZE 是硬上限」和「语义切分不再按句收费」。

为什么单独一个文件：这两条都是这一轮量出来的产品级缺陷（交接文档 §15/§16.6 ④），
而修完之后最容易发生的事就是「以后有人把它改回去、没人发现」。
所以每一条断言都配**正样本**（能失败的那种），并且全程用假件：
不需要 embedding 模型、不需要网络、不动任何真数据。

用法：
    apps/backend/.venv/bin/python scripts/selfcheck_splitter.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "backend"))

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'✓' if ok else '✗'} {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILS.append(label)


class FakeSemantic:
    """假装是 SemanticChunker：记录被调用了几次，产出故意超上限的块看有没有被夹住。"""

    def __init__(self, calls: list[str], pieces: list[str] | None = None):
        self._calls = calls
        self._pieces = pieces

    def split_text(self, text: str) -> list[str]:
        self._calls.append(text)
        if self._pieces is not None:
            return list(self._pieces)
        # 默认：交回一段比上限还长的东西，逼 _enforce 那道闸显形
        return [text, text[:900]]


def build(semantic=False, calls=None, pieces=None, chunk_size=512, chunk_overlap=64,
           on_skip=None, raise_factory=False):
    from src.vector.documents.splitter import BoundedChunker

    def factory():
        if raise_factory:
            raise RuntimeError("embedding 句柄坏了")
        return FakeSemantic(calls if calls is not None else [], pieces)

    return BoundedChunker(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        semantic=semantic,
        semantic_factory=factory if semantic else None,
        on_skip=on_skip,
    )


def cn_paragraph(chars: int, seed: int = 0) -> str:
    """没有空格、只有「。」的中文长段 —— 旧正则下整段就是一个句子。"""
    sentences = []
    i = seed
    total = 0
    while total < chars:
        i += 1
        s = f"第{i}句讲的是编号{i}的中文内容，用来凑出足够长的段落。"
        sentences.append(s)
        total += len(s)
    return "".join(sentences)


def structured_doc(paragraphs: int = 20, size: int = 260) -> str:
    blocks = []
    for i in range(1, paragraphs + 1):
        blocks.append(f"## 小节 {i}\n\n" + cn_paragraph(size, seed=i * 97))
    return "\n\n".join(blocks)


def gate_hard_cap() -> None:
    print("\n── 1. chunk_size 是承诺不是建议")
    text = cn_paragraph(1409)  # 实测过的「配置写 512、切出 1409 字」那个量级
    for semantic in (False, True):
        calls: list[str] = []
        chunker = build(semantic=semantic, calls=calls, chunk_size=512)
        chunks = chunker.split_text(text)
        longest = max(len(c) for c in chunks)
        check(f"超长段落（1409 字）全部 ≤512，semantic={semantic}",
              longest <= 512 and len(chunks) >= 2, f"{len(chunks)} 块，最长 {longest}")
    # 正样本：假语义切分器故意交回 900 字的块，也必须被夹住（不是恒真）
    calls = []
    fat = build(semantic=True, calls=calls, pieces=["。".join(["填充内容" * 20] * 40)],
                chunk_size=512)
    chunks = fat.split_text(cn_paragraph(600))
    check("语义切分交回超上限的块时，硬闸仍然生效（正样本）",
          all(len(c) <= 512 for c in chunks) and bool(chunks),
          f"最长 {max(len(c) for c in chunks)}")


def gate_cost() -> None:
    print("\n── 2. 结构正常的文档一次 embedding 都不发")
    text = structured_doc(20)
    calls: list[str] = []
    chunker = build(semantic=True, calls=calls, chunk_size=512)
    chunks = chunker.split_text(text)
    check("20 个小节的文档：语义切分器没被调用过",
          len(calls) == 0 and len(chunks) >= 10, f"{len(chunks)} 块，调用 {len(calls)} 次")

    # 正样本：同样的内容并成一个超长段 ⇒ 必须调用（证明计数器真的在数东西）
    calls2: list[str] = []
    merged = text.replace("\n\n", "")
    chunker2 = build(semantic=True, calls=calls2, chunk_size=512)
    chunker2.split_text(merged)
    check("并成一整段之后就必然调用语义切分（正样本，证明上一条不是恒真）",
          len(calls2) > 0, f"调用 {len(calls2)} 次")

    # SEMANTIC_SPLITTER=false 时无论如何都不该碰 embedding
    calls3: list[str] = []
    build(semantic=False, calls=calls3, chunk_size=512).split_text(merged)
    check("semantic=False 时超长段也不碰 embedding", len(calls3) == 0, f"调用 {len(calls3)} 次")


def gate_chinese_sentences() -> None:
    print("\n── 3. 中文断句（旧默认正则的病）")
    text = "首先说明甲。其次说明乙。最后说明丙。" + cn_paragraph(1200)
    chunks = build(semantic=False, chunk_size=512).split_text(text)
    check("没有空格的中文也能切成多块", len(chunks) >= 3, f"{len(chunks)} 块")
    check("块尾落在句子边界上，不是从句中劈开",
          all(c[-1] in "。？！；.?!;:：\n" or len(c) < 40 for c in chunks),
          repr([c[-6:] for c in chunks][:3]))


def gate_degradation() -> None:
    print("\n── 4. 语义切分坏了要降级，不许把入库带崩")
    from src.vector.documents.splitter import BoundedChunker

    skipped: list[str] = []
    chunker = build(semantic=True, raise_factory=True, on_skip=skipped.append, chunk_size=512)
    chunks = chunker.split_text(cn_paragraph(1300))
    check("factory 抛异常时仍出块，并且记了一次降级",
          bool(chunks) and all(len(c) <= 512 for c in chunks) and len(skipped) == 1,
          f"{len(chunks)} 块；skipped={skipped[:1]}")

    # 正样本：单元长度在 semantic_max_chars 以内时必须走语义那条路（否则上一条可能是恒真）
    inside: list[str] = []
    build(semantic=True, calls=inside, chunk_size=512).split_text(cn_paragraph(3000))
    check("3000 字的单元确实走了语义切分（正样本）", len(inside) == 1, f"调用 {len(inside)} 次")

    skipped2: list[str] = []
    max_chars = BoundedChunker(chunk_size=512, semantic=True).semantic_max_chars
    big = cn_paragraph(max_chars + 500)
    chunks2 = build(semantic=True, on_skip=skipped2.append, chunk_size=512).split_text(big)
    check(f"超过 semantic_max_chars（{max_chars}）的单元退回句子对齐并记录，不再整本付费",
          bool(chunks2) and all(len(c) <= 512 for c in chunks2) and len(skipped2) == 1,
          f"{len(chunks2)} 块，最长 {max(len(c) for c in chunks2)}")


def _shared_boundary(a: str, b: str, limit: int = 120) -> int:
    """a 的结尾与 b 的开头共用的字符数（独立算一遍，不用被测代码的私有函数）。"""
    for n in range(min(limit, len(a), len(b)), 0, -1):
        if a[-n:] == b[:n]:
            return n
    return 0


def gate_overlap_and_headings() -> None:
    print("\n── 5. overlap 真实存在，标题不孤块")
    text = structured_doc(24, size=300)
    chunks = build(semantic=False, chunk_size=512, chunk_overlap=100).split_text(text)
    shared = max(_shared_boundary(a, b) for a, b in zip(chunks, chunks[1:]))
    check("相邻块之间确实共享一段尾部内容（overlap 生效）", shared >= 20, f"最大共享 {shared} 字")
    check("带 overlap 之后仍然不破上限",
          all(len(c) <= 512 for c in chunks), f"最长 {max(len(c) for c in chunks)}")

    # 正样本：overlap=0 时不该有共享（否则上面那条可能是恒真）
    flat = build(semantic=False, chunk_size=512, chunk_overlap=0).split_text(text)
    flat_shared = max(_shared_boundary(a, b) for a, b in zip(flat, flat[1:]))
    check("overlap=0 时确实不共享（正样本）", flat_shared < 20, f"最大共享 {flat_shared} 字")

    chunks2 = build(semantic=False, chunk_size=512, chunk_overlap=0).split_text(
        "# 只有一个标题的章节\n\n正文从这里开始，" + cn_paragraph(400)
    )
    check("标题不会单独成块", all(not c.strip().startswith("#") or len(c) > 40 for c in chunks2),
          repr(chunks2[0][:24]) if chunks2 else "空")


def gate_wiring() -> None:
    print("\n── 6. 配置真的接到了分块器上（这条就是「CHUNK_SIZE 是死参数」的反向断言）")
    from src.config import chunk_overlap, chunk_size
    from src.vector.documents.splitter import BoundedChunker

    splitter = build(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    check("构造出来的分块器认 CHUNK_SIZE",
          isinstance(splitter, BoundedChunker)
          and splitter.chunk_size == max(120, chunk_size),
          f"chunk_size={splitter.chunk_size} overlap={splitter.chunk_overlap}")

    # get_splitter() 不许在构造期碰网络/要求 embedding 句柄。
    # 计时之前先把模块导好：`import src.client` 自己就要 2-3 s（langchain/transformers），
    # 把它算进「构造分块器的代价」会得到一条假红灯（这一轮真的撞上过）。
    from src.client import get_splitter

    t0 = time.perf_counter()
    live = get_splitter()
    cost = time.perf_counter() - t0
    check("get_splitter() 是惰性的：构造一次就返回，不请求 embedding",
          isinstance(live, BoundedChunker)
          and live.chunk_size == max(120, chunk_size)
          and cost < 0.5,
          f"{cost * 1000:.1f} ms，上限 {live.chunk_size}")


def main() -> int:
    try:
        gate_hard_cap()
        gate_cost()
        gate_chinese_sentences()
        gate_degradation()
        gate_overlap_and_headings()
        gate_wiring()
    except Exception as exc:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        FAILS.append(f"自检自己崩了：{type(exc).__name__}: {exc}")
    print()
    if FAILS:
        print(f"✗ {len(FAILS)} 项没过：" + "；".join(FAILS))
        return 1
    print("SPLITTER_PASS 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
