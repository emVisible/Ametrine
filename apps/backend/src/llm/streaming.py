"""推理流的名额守卫：并发上限要覆盖**整个流的生命周期**。

为什么需要这一个模块：`SEMAPHORE` 原本在 `/api/llm/chat` 与 `/api/llm/rag` 上是这么写的 ——

    async with get_semaphore(TaskType.LLM):
        res = service.llm_model.chat(...)      # 只是「创建」了流对象
    return StreamingResponse(service.stream_by_token(res), ...)

`async with` 在真正产出第一个 token 之前就退出了作用域，所以那个信号量限的是
「开流的瞬间」，不是「正在生成的请求数」：32 路并发的意思是「同一瞬间能创建 32 个流」，
之后多少路在真正烧推理算力，它一概不管。`/api/chat` 那两条生成器路径写法是对的
（名额包住了整个消费循环），于是同一个应用里存在两种语义 —— 而错的这两种入口里
恰好是前端在用的那两个。

这里把三份需求收成一个实现：
1. **全局并发**：复用既有的 `get_semaphore(TaskType)`，名额持有到流结束；
2. **单用户并发**：Redis 计数，超了直接 429 —— 否则一个人开 32 个标签页就能占满整台机器；
3. **块间空闲超时**：上游卡住时不会永远占着一个名额。刻意是「空闲」而不是「总时长」，
   因为长答案本身是合法需求，把它一起限掉就是拿可用性换安心。
"""

from asyncio import TimeoutError as AsyncTimeoutError, to_thread, wait_for
from contextlib import asynccontextmanager
from json import dumps
from uuid import uuid4

from fastapi import HTTPException, status
from src.client import TaskType, get_semaphore
from src.config import max_concurrent_streams_per_user, stream_idle_timeout_seconds
from src.middleware.logger import config_logger

# 计数键的存活时间：进程被 kill 时 finally 不会跑，泄漏的名额靠这个 TTL 自愈。
_SLOT_TTL_SECONDS = 3600


def _slot_key(user_id: int) -> str:
    return f"stream_active:{user_id}"


async def aiter_sync(source):
    """把**同步**生成器搬到线程里逐块取。

    这不是风格问题，是并发能力问题。xinference 的流式句柄是同步生成器，
    原来的写法 `for chunk in res:` 直接跑在协程里 —— 实测两路各 3×0.2 s 的生成
    并发跑要 **1.20 s**（完全串行），把同样的内容放线程里是 **0.60 s**。
    也就是说在此之前：**任何一个人正在生成回答时，整个事件循环都被占住**，
    别人的请求、健康检查、甚至 `/api/current` 都要排队。
    每台机器只有 32 个信号量名额这件事根本不重要，因为真正串行的是那条循环。

    `next(iterator, sentinel)` 而不是 `try/except StopIteration`：
    生成器耗尽时 `StopIteration` 穿过协程边界会变成 `RuntimeError`，
    拿哨兵值判断是唯一干净的写法。
    """
    sentinel = object()
    iterator = iter(source)
    while True:
        chunk = await to_thread(next, iterator, sentinel)
        if chunk is sentinel:
            return
        yield chunk


class StreamGuard:
    """一次推理生成的名额。`open()` 拿名额，`stream()` 放名额。"""

    def __init__(self, semaphore, release_user_slot):
        self._semaphore = semaphore
        self._release_user_slot = release_user_slot
        self._closed = False

    @classmethod
    async def open(cls, task_type: TaskType, redis_client=None, user_id=None):
        # 单用户判断放在全局 acquire 之前：超额的人不该先把名额吃掉再失败。
        release_slot = None
        if redis_client is not None and user_id is not None and max_concurrent_streams_per_user > 0:
            key = _slot_key(user_id)
            try:
                active = int(redis_client.get(key) or 0)
            except (TypeError, ValueError):
                # 计数读坏了就当没有，别把一个可用功能钉死在脏数据上。
                config_logger.warning("stream slot counter unreadable for user %s", user_id)
                active = 0
            if active >= max_concurrent_streams_per_user:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        f"你已有 {active} 个回答在生成中，单账号上限 "
                        f"{max_concurrent_streams_per_user} 路。等一条结束再问。"
                    ),
                )
            redis_client.incr(key)
            redis_client.expire(key, _SLOT_TTL_SECONDS)

            def release_slot():  # noqa: F811
                remaining = redis_client.decr(key)
                if remaining is not None and remaining <= 0:
                    redis_client.delete(key)

        semaphore = get_semaphore(task_type)
        await semaphore.acquire()
        return cls(semaphore, release_slot)

    def close(self):
        if self._closed:
            return
        self._closed = True
        self._semaphore.release()
        if self._release_user_slot:
            self._release_user_slot()

    async def stream(self, chunks):
        """消费上游流并把名额持有一路到底。

        客户端断连时 Starlette 会关掉这个生成器，`finally` 照样执行 ——
        这正是原来那版做不到的事：断连之后名额早还回去了，但生成还在跑。

        上游异常必须在这里收口。`StreamingResponse` 在产出第一块之前就已经把
        200 和响应头发出去了，异常逃出生成器时 Starlette 只能把它记进服务器日志，
        浏览器那头看到的仍是一个「成功的、但是空的」回答。实测踩到过一次：
        gemma worker 触发 `CUDA error: device-side assert triggered` 之后进入
        sticky 状态，随后 48 次 `/api/llm/rag` 全部以 HTTP 200 + 零 token 结束，
        界面是一条空白气泡，用户无从知道模型已经死了。
        """
        iterator = chunks.__aiter__()
        try:
            while True:
                try:
                    chunk = await wait_for(iterator.__anext__(), stream_idle_timeout_seconds)
                except StopAsyncIteration:
                    break
                except AsyncTimeoutError:
                    config_logger.error(
                        "stream idle timeout after %ss, closing", stream_idle_timeout_seconds
                    )
                    yield dumps(
                        {"error": f"上游模型在 {stream_idle_timeout_seconds} 秒内没有产出新内容"}
                    ) + "\n"
                    break
                except Exception as exc:  # noqa: BLE001
                    # 错误编号进日志、不进响应：上游原文含 worker 的 ip:port 与 pid。
                    ref = uuid4().hex[:8]
                    config_logger.error("stream aborted [%s]: %s", ref, exc)
                    yield dumps(
                        {"error": f"生成中断（错误编号 {ref}），这条请求请重试"}
                    ) + "\n"
                    break
                yield chunk
        finally:
            self.close()


@asynccontextmanager
async def inference_slot(task_type: TaskType, redis_client=None, user_id=None):
    """非流式场景的同一套名额（保持只有一份语义，不让第二种写法长出来）。"""
    guard = await StreamGuard.open(task_type, redis_client, user_id)
    try:
        yield guard
    finally:
        guard.close()
