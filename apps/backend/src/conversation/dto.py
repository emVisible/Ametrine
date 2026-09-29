from pydantic import BaseModel

class AddMessageDTO(BaseModel):
    role: str
    content: str
    # 引用（citations）原来只活在 Redis 的 chat_ref:{user}:{session} 里，TTL 600 秒。
    # 也就是说服务器对「这句话引用了哪些分块」没有任何长期记录：
    # 换设备、清缓存、或者十分钟后回看，引用就没了，而引用恰恰是 RAG 答案可信的部分。
    meta: dict | None = None