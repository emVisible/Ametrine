// src/api/conversation.ts
import { apiClient } from './client'

/** 后端 /conversation/{id}/messages 的返回形状 */
export interface StoredMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  created_at?: string
  /** 服务端按「有没有引用 / 有没有报错」推导出来的状态，客户端传不动它 */
  status?: 'done' | 'no_reference' | 'failed'
  feedback?: { verdict: 'up' | 'down'; note?: string | null; user_id: number } | null
  /** 引用等附随数据。RAG 的答案离了引用就没有可核对的部分，
   *  原来它只活在 Redis 的 600 秒里，服务器对「这句引了哪些分块」毫无记录。 */
  meta?: { references?: unknown[] } | null
}

export const conversationAPI = {
  /**
   * 不传 title：让后端用它自己的默认值。
   * 以前这里硬编码 '新对话'，等于把界面语言写进了数据层；
   * 后端的自动改名逻辑正是拿这个字面量当「未命名」哨兵（service.py:103）。
   */
  create: (mode: string = 'llm') =>
    apiClient<{ id: string }>('/conversation/create', {
      method: 'POST',
      body: { mode },
    }),

  /** 会话标题以前只存在浏览器里：换设备/清缓存后就再也认不出是哪一段对话。 */
  rename: (convId: string, title: string) =>
    apiClient(`/conversation/${convId}/title?title=${encodeURIComponent(title)}`, {
      method: 'PATCH',
    }),

  addMessage: (
    convId: string,
    role: string,
    content: string,
    meta?: Record<string, unknown> | null,
    // 只是把服务端在响应头里给出的检索会话号原样带回去。
    // 检索中间态的数字全部由服务端按这个号从 Redis 取回，前端一个字段都不填 ——
    // 「这次检索拿到几条」要是不属于服务端，它就成了又一个可以被随意编造的字段。
    retrievalSession?: string | null,
  ) =>
    apiClient<{ id: string }>(`/conversation/${convId}/message`, {
      method: 'POST',
      body: { role, content, meta, retrieval_session: retrievalSession ?? null },
    }),

  /** 反馈只存「好/坏 + 一句为什么」。它不改变任何回答行为 ——
   *  唯一用途是把「差评 ∧ 无依据」变成管理台里能筛的队列。 */
  setFeedback: (messageId: string, verdict: 'up' | 'down', note?: string) =>
    apiClient(`/conversation/message/${messageId}/feedback`, {
      method: 'PUT',
      body: { verdict, note: note ?? null },
    }),

  dropFeedback: (messageId: string) =>
    apiClient(`/conversation/message/${messageId}/feedback`, {
      method: 'DELETE',
    }),

  /** 管理台的未解决队列（仅管理员）。 */
  getUnresolved: (limit = 50, offset = 0) =>
    apiClient<UnresolvedRow[]>(`/conversation/unresolved?limit=${limit}&offset=${offset}`),

  getMessages: (convId: string) =>
    apiClient<StoredMessage[]>(`/conversation/${convId}/messages`),
}

/** 一条「值得回去修库」的回答：状态、差评备注、以及当时用的库与集合。 */
export interface UnresolvedRow {
  message_id: string
  conversation_id: string
  conversation_title: string
  asked_by: string
  content: string
  status: string
  verdict?: 'up' | 'down' | null
  note?: string | null
  database_name?: string | null
  collection_name?: string | null
  created_at?: string
  /** 服务端当场记下的检索事实；没有检索的消息就是 null（不补 0）。 */
  retrieval?: {
    sources: { database: string; collection: string }[]
    source_count: number
    top_k: number
    candidates: number
    returned: number
    elapsed_ms: number
    outcome: 'ok' | 'no_hits' | 'filtered_out'
    reranked: boolean
    score_min?: number
    score_max?: number
  } | null
}