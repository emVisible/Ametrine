#!/usr/bin/env python
"""打印三个角色当前绑定的 model_uid（每行一个），给 shell 脚本当目标清单用。

为什么要有这个文件：**「等模型就绪」等的是哪几个模型**这件事，现在归绑定表说了算。
以前 dev.sh 从 `.env` 读 `XINFERENCE_*_MODEL_ID` 拼清单 —— 那是管理台出现**之前**的口径，
在界面里换了模型之后，脚本还在等旧名字，于是「界面已经换好了，终端却卡在等待里」。
读绑定表 = 和 `/api/system/ready`、推理 getter 用的是同一份事实。

表是空的（从没在管理台配过）时，`bindings.bootstrap()` 会按老规矩拿 .env 播种，
所以第一次跑也照样有输出 —— 这是兼容路径，不是第二份真相。
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "apps" / "backend"
sys.path.insert(0, str(BACKEND))


async def main() -> int:
    from src.client import async_session
    from src.inference import bindings

    async with async_session() as session:
        await bindings.bootstrap(session)
        snap = bindings.snapshot()
    for row in snap["roles"]:
        # 只打印非空 uid；空绑定不该变成一个「等空字符串」的死循环
        if row["model_uid"]:
            print(row["model_uid"])
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
