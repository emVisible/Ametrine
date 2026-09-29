"""Milvus 命名约束。

集合名与库名都会原样传给 Milvus，而 Milvus 只接受「字母、数字、下划线」
（实测违反时报 `MilvusException (code=1100) Invalid collection name: …`）。
创建接口此前不校验，于是出现这样一种坏状态：Postgres 里的 collection 行先写成功、
Milvus 建集合失败，留下一条**永远检索不到、也无法通过界面理解**的幽灵集合
（本机 `faman-collection` 就是这样）。

只在「创建/改名」上校验：`CollectionUniversalDto` 与 `DatabaseUniversalDto` 也被
get/delete 使用，若一起卡住，已经存在的非法名字就再也删不掉了。
"""

from typing import Annotated

from pydantic import StringConstraints

MILVUS_NAME_PATTERN = r"^[A-Za-z0-9_]{1,255}$"

MilvusName = Annotated[
    str,
    StringConstraints(pattern=MILVUS_NAME_PATTERN, min_length=1, max_length=255),
]

MILVUS_NAME_HINT = "只能用字母、数字和下划线，长度 1–255（Milvus 不接受连字符等其他字符）"
