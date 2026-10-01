"""发布版本号的唯一来源。

为什么要有这个文件：这一轮核对 meta 时发现同一个产品在四个地方写了三个不同的值 ——
`main.py` 的 OpenAPI 写 `1.0.0`、`/health` 写 `0.1.0`、`pyproject.toml` 写 `0.1.0`、
`apps/frontend/package.json` 写 `0.0.0`，而 git 上最新的 tag 是 `v0.2.0`。
「版本更新」如果靠人记着改四处，下一次发布照样会自相矛盾。

改版本时的动作（一次做完，别漏）：
1. 这里的 `APP_VERSION`；
2. `apps/backend/pyproject.toml` 的 `version`，以及 `apps/backend/uv.lock` 里
   `name = "backend"` 那条的 `version`（只改这两个字符串不会触发依赖重解析 ——
   这台机器的 `uv lock` 要联网，见交接文档的依赖雷）；
3. `apps/frontend/package.json` 的 `version`；
4. 打 tag：`git tag -a v<版本> -m …`。

`/health` 与 OpenAPI 都读这里，所以「部署的是哪一版」这一问只有一个答案。
"""

APP_VERSION = "0.3.0"
