"""有尺寸上限的分块器：结构优先，语义只在必要处介入，成本可预测。

为什么不是原来的两条路（实测数字都在交接文档 §15/§16）：

* `SemanticChunker` 直接吃**整篇文档** ⇒ 它对**每一句**都要请求一次向量
  （实测 1,592 字 10.69 s；epub 整本两次 >900 s 都没落库），
  而且它**没有 chunk_size 这个字段** —— 于是 `CHUNK_SIZE=512` 在默认配置下完全不参与，
  实测切出过 1,409 字的块。`.env` 里那两个数是假的。
* `RecursiveCharacterTextSplitter` 便宜但会**从句子中间切开**，对中文/长段落尤其糟。

这里的做法是把两件事分开：
1. **结构优先**：按段落与标题成块，块预算 = `chunk_size - chunk_overlap`，
   相邻块之间带上前一块的尾部句子做 overlap（都在句子边界上，不从句中切）。
   正常排版的文档走这条路**一次 embedding 都不发**。
2. **语义只在超长结构单元内部用**：只有超过 `chunk_size` 的单个段落/标题块才有
   「该从哪儿切」的歧义，这时才对**这一段**跑语义切分；超过 `semantic_max_chars`
   就退回句子对齐的贪心成块并记进日志 —— 那类输入下语义切分要付的是整本的代价，
   而它的收益已经不值得这个价。
3. **硬上限**：任何路径产出的块都过一遍定长切分，保证 ≤ `chunk_size`。

`SEMANTIC_SPLITTER=false` 时走 1+3（不碰 embedding），与旧的定长路径相比仍是进步：
切点落在句子/段落边界上，不再从句中切开。
"""

from __future__ import annotations

import re
from typing import Callable, List, Optional

from langchain.docstore.document import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 断句要认中文标点：默认那套 `(?<=[.?!])\s+` 要求标点后跟空白，
# 中文「。」后面没有空格 ⇒ 整篇文档被当成 1 个句子原样返回（一篇 = 一块 = 一条向量）。
_SENTENCE_SPLIT = re.compile(r"(?<=[.?!。？！;；:：])\s*")
# 结构边界：空行分段，标题行永远和它后面的正文留在同一块里
_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
_HEADING = re.compile(r"^(#{1,6}\s|\d+[.、]\s|[一二三四五六七八九十]+[、.])")
_MIN_PIECE = 40


def split_sentences(text: str) -> list[str]:
    parts = [p for p in _SENTENCE_SPLIT.split(text) if p and p.strip()]
    if not parts:
        return [text] if text.strip() else []
    # 过碎的片段（比如一连串短句）并进前一句，避免 overlap 里塞满标点
    merged: list[str] = []
    for p in parts:
        if merged and len(p) < _MIN_PIECE and len(merged[-1]) + len(p) < _MIN_PIECE * 6:
            merged[-1] = f"{merged[-1]} {p}".strip()
        else:
            merged.append(p.strip())
    return merged


def structural_units(text: str) -> list[str]:
    """段落级结构单元；标题行粘到紧随其后的段落上，不单独成块。"""
    raw = [b.strip() for b in _PARAGRAPH_SPLIT.split(text) if b.strip()]
    units: list[str] = []
    pending_heading = ""
    for block in raw:
        lines = block.splitlines()
        if len(lines) > 1 and _HEADING.match(lines[0]):
            # 一块里既有标题又有正文：标题单独留下，正文继续当段落走
            pending_heading = pending_heading + "\n" + lines[0] if pending_heading else lines[0]
            rest = "\n".join(lines[1:]).strip()
            if rest:
                units.append(f"{pending_heading}\n{rest}" if pending_heading else rest)
                pending_heading = ""
            continue
        if _HEADING.match(block):
            pending_heading = pending_heading + "\n" + block if pending_heading else block
            continue
        units.append(f"{pending_heading}\n{block}" if pending_heading else block)
        pending_heading = ""
    if pending_heading:
        units.append(pending_heading)
    return units


class BoundedChunker:
    """`chunk_size` 在这里是**承诺**，不是建议。"""

    def __init__(
        self,
        *,
        chunk_size: int,
        chunk_overlap: int = 0,
        semantic: bool = False,
        semantic_max_chars: int = 20000,
        semantic_factory: Optional[Callable[[], object]] = None,
        on_skip: Optional[Callable[[str], None]] = None,
    ):
        self.chunk_size = max(120, int(chunk_size))
        # overlap 只吃预算的一小部分：块太小的时候留 1/4 给重叠会把正文挤没
        self.chunk_overlap = max(0, min(int(chunk_overlap), self.chunk_size // 3))
        self.semantic = semantic
        self.semantic_max_chars = semantic_max_chars
        self._semantic_factory = semantic_factory
        self._on_skip = on_skip
        self._semantic_splitter = None
        self._fallback = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=min(self.chunk_overlap, self.chunk_size // 10),
            separators=["\n\n", "\n", "。", "？", "！", "；", ".", "?", "!", ";", " ", ""],
            keep_separator=True,
        )

    # ── 对外形状与 langchain 的分块器一致（loader.py 只调这两个方法）──
    def split_documents(self, documents: List[Document]) -> List[Document]:
        out: List[Document] = []
        for doc in documents:
            for piece in self.split_text(doc.page_content):
                out.append(Document(page_content=piece, metadata=dict(doc.metadata or {})))
        return out

    def split_text(self, text: str) -> List[str]:
        budget = self.chunk_size - self.chunk_overlap
        units = structural_units(text)
        if not units:  # 没有段落结构的长文：整篇就是一个单元
            units = [text.strip()] if text.strip() else []

        chunks: list[str] = []
        buf = ""
        for unit in units:
            if len(unit) > self.chunk_size:
                if buf:
                    chunks.append(buf)
                    buf = ""
                chunks.extend(self._split_oversized(unit, budget))
                continue
            if buf and len(buf) + len(unit) + 2 > budget:
                chunks.append(buf)
                buf = unit
            else:
                buf = f"{buf}\n\n{unit}".strip() if buf else unit
        if buf:
            chunks.append(buf)

        return self._apply_overlap([c for c in chunks if c.strip()])

    # ── 内部 ──
    def _split_oversized(self, unit: str, budget: int) -> list[str]:
        if self.semantic and len(unit) <= self.semantic_max_chars:
            semantic = self._semantic_pieces(unit)
            if semantic:
                return self._enforce([s for s in semantic if s.strip()], budget)
            # 语义切分没结果（embedding 上游坏了、或构造不出来）⇒ 退回句子对齐，
            # 而不是把整次入库带崩 —— 降级已经在 _semantic_pieces 里记过了。
        elif self.semantic:
            self._note_skip(
                f"有一个 {len(unit)} 字的结构单元超过了语义切分上限 "
                f"{self.semantic_max_chars}，本块退回句子对齐切分"
            )
        return self._pack_sentences(unit, budget)

    def _semantic_pieces(self, unit: str) -> list[str]:
        try:
            splitter = self._get_semantic_splitter()
            if splitter is None:
                return []
            return [p for p in splitter.split_text(unit) if p and p.strip()]  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001 —— 语义是加分项，不该决定入库成不成
            # 包括「embedding 句柄根本构造不出来」：那条以前会在第一步就把整次上传带崩，
            # 而那篇文档本来用句子对齐就能进库。
            self._note_skip(
                f"语义切分不可用（{type(exc).__name__}），该单元退回句子对齐切分"
            )
            return []

    def _get_semantic_splitter(self):
        if not self.semantic or self._semantic_factory is None:
            return None
        if self._semantic_splitter is None:
            self._semantic_splitter = self._semantic_factory()
        return self._semantic_splitter

    def _pack_sentences(self, unit: str, budget: int) -> list[str]:
        """句子对齐的贪心成块：宁可短一点，也不从句子中间切。"""
        out: list[str] = []
        buf = ""
        for sentence in split_sentences(unit):
            if len(sentence) > self.chunk_size:
                if buf:
                    out.append(buf)
                    buf = ""
                # 连一句都超上限（无标点的长串、代码块）：只剩定长这一条路
                out.extend(self._fallback.split_text(sentence))
                continue
            if buf and len(buf) + len(sentence) + 1 > budget:
                out.append(buf)
                buf = sentence
            else:
                buf = f"{buf} {sentence}".strip() if buf else sentence
        if buf:
            out.append(buf)
        return out

    def _enforce(self, pieces: list[str], budget: int) -> list[str]:
        """最后一道闸：任何来源的块都不许超过 chunk_size。"""
        out: list[str] = []
        for piece in pieces:
            if len(piece) <= self.chunk_size:
                out.append(piece)
            else:
                out.extend(self._fallback.split_text(piece))
        return out

    def _apply_overlap(self, chunks: list[str]) -> list[str]:
        if self.chunk_overlap <= 0 or len(chunks) < 2:
            return chunks
        out = [chunks[0]]
        for prev, cur in zip(chunks, chunks[1:]):
            tail = _tail_at_sentence(prev, self.chunk_overlap)
            # 已经重复了就不硬塞；塞进去会顶破上限时也不塞
            if tail and not cur.startswith(tail) and len(tail) + len(cur) <= self.chunk_size:
                out.append(f"{tail}\n{cur}")
            else:
                out.append(cur)
        return out

    def _note_skip(self, reason: str) -> None:
        if self._on_skip:
            self._on_skip(reason)


def _tail_at_sentence(text: str, limit: int) -> str:
    """取 text 末尾 limit 以内的尾巴，作为下一块的前缀。

    必须返回 text 的**真实后缀**：前一版是拿 `split_sentences` 的产物截尾，
    而那个函数为了合并短句会在片段之间补空格 —— 于是「overlap」是一段重新拼装出来的文本，
    不是上一块的内容。中文原文里没有那些空格，等于分块器往下一块里塞了并不存在的字。
    现在只在原始文本上操作：先按预算取尾，再把左端推到最近的句子边界。
    """
    if limit <= 0 or not text:
        return ""
    tail = text[-limit:]
    starts = [i + 1 for i, ch in enumerate(tail) if ch in "。？！；?!;：:" and i + 1 < len(tail)]
    # 取最靠前的那个句末之后：宁可少重叠一点，也不要从句中开始。
    # 注意这里是切片 `[n:]` 而不是取值 `[n]` —— 少一个冒号就等于「overlap 只有一个字」，
    # 而它照样能通过「b 以 tail 开头」那种弱断言。
    return tail[min(starts):] if starts else tail
