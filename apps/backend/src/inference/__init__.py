"""推理面：xinference 的薄封装 + 本系统唯一新增的那张角色绑定表。

刻意**不在这里 re-export** `controller` / `service`：
`service` 依赖 `auth`，`auth` 又要在函数内延迟 import `src.client`（共享句柄），
而 `src.client` 会 import 本包的 `bindings`。包级 re-export 会让这条链在导入期就打结。
需要路由的地方直接 `from src.inference.controller import route_inference`。
"""
