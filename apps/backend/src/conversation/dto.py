from pydantic import BaseModel

class AddMessageDTO(BaseModel):
    role: str
    content: str
    # 引用（citations）原来只活在 Redis 的 chat_ref:{user}:{session} 里，TTL 600 秒。
    # 也就是说服务器对「这句话引用了哪些分块」没有任何长期记录：
    # 换设备、清缓存、或者十分钟后回看，引用就没了，而引用恰恰是 RAG 答案可信的部分。
    meta: dict | None = None
    # 检索中间态的取回凭据。客户端**只能**给一个会话号，数字一律由服务端从 Redis 取回 ——
    # 「这次检索拿到几条、最高分多少」是回答质量的事实，让上报方自己填就等于没有。
    # 会话号本身不带权限语义：Redis 键里含 user_id，换不回别人的证据。
    retrieval_session: str | None = None



class FeedbackDTO(BaseModel):
    """反馈只存事实：一个好/坏 +  optionally 一句「错在哪」。

    没有 score、没有分类树 —— 那些都需要有人去维护和统计，
    而这条链路唯一的目的就是把「值得回去修库」的消息筛出来。
    """

    verdict: str
    note: str | None = None