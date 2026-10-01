"""向量库侧的名字规则。

PG 接受任意字符串，Milvus 只接受「字母或下划线开头 + 字母数字下划线，≤255」。
中间没有校验时长出来的是**半条记录**：`/relation/collection/create` 先 `commit()` PG、
后同步 Milvus，于是名字非法时 PG 里留下一条永远检索不到的记录 —— 本机实测就是
`faman-collection`（列表里看得见它，向它问一句话拿 500）。

而且 `has_collection()` 对**非法名字是抛异常**，不是返回 False：
所以那条路径连「集合不存在」这个干净答案都给不出来。这个文件存在的意义就是
让那种记录根本写不进去，而不是事后在读取面上猜异常。
"""

from __future__ import annotations

import re

# Milvus 2.5 的规则：首字符字母或下划线，其后可含数字，长度 1..255。
_VECTOR_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,254}$")


def vector_name_error(kind: str, name: object) -> str | None:
    """这个名字两边都能用吗？能则 None，不能则一句给用户看的话。

    `kind` 只进文案（「知识库」/「集合」），不参与判定 —— 两处的规则是同一条。
    """
    if not isinstance(name, str) or not name:
        return f"{kind}名字不能为空"
    if name != name.strip():
        return f"{kind}名字两端不能留空格"
    if not _VECTOR_NAME.match(name):
        return (
            f"{kind}名字「{name}」向量库不接受：只能是字母、数字和下划线，"
            "且必须以字母或下划线开头（最长 255 字符）"
        )
    return None
