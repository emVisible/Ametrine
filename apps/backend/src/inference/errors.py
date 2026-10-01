"""推理面的错误类型。

沿用本项目既有的口径：**类型名出去，堆栈留下**（交接文档 §6.7）。
`XinferenceUnavailable` 和 `TokenizerUnavailable` 一样，靠 main.py 注册的异常处理器
翻译成有意义的状态码，而不是让路由里的 try/except 各自决定 —— 依赖解析阶段抛出的异常
会绕过路由内所有的 try/except，那是本机实测过的。
"""


class XinferenceUnavailable(Exception):
    """连不上 xinference，或凭据不可用（登录失败/在冷却期内）。

    回 503：这不是调用方的错，改请求参数也没用。
    """

    def __init__(self, message: str, retry_after: float = 0.0):
        super().__init__(message)
        self.retry_after = max(0.0, retry_after)


class XinferenceRejected(Exception):
    """xinference 明确拒绝了这个动作（409 冲突、404 没这个模型、422 参数不对）。

    状态码原样带上，由控制层翻译成我们自己的信封 —— 这些是「正常答案」而不是故障，
    不该被压成 500。
    """

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class ModelUnavailable(Exception):
    """绑定指向的模型在服务器上不存在（没加载，或 uid 写错了）。

    为什么单独一个类型：这条以前是裸 `RuntimeError`，于是它穿过
    `unhandled_exception_handler` 变成**500 + 追踪码**。而它其实是
    「依赖没就绪」，不是「我们崩了」—— 和 §6.7 里分词器那条完全同族，
    当时只修了分词器，模型这条路留到了现在。
    回 503 并直接说出「去管理台『模型推理』页加载它」，
    用户/运维不必再去翻 ametrine.log 才知道是这回事。
    """

    def __init__(self, model_uid: str, reason: str = "", retry_after: float = 0.0):
        self.model_uid = model_uid
        self.retry_after = max(0.0, retry_after)
        super().__init__(
            f"模型「{model_uid}」当前不可用"
            + (f"：{reason}" if reason else "")
            + "。到管理台「模型推理」页加载它，或把该角色的绑定改成已在运行的模型。"
        )
