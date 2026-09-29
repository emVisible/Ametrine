// src/api/conversation.ts
import { apiClient } from './client'

/** 后端 /conversation/{id}/messages 的返回形状 */
export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  created_at?: string
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

  addMessage: (convId: string, role: string, content: string) =>
    apiClient(`/conversation/${convId}/message`, {
      method: 'POST',
      body: { role, content },
    }),

  getMessages: (convId: string) =>
    apiClient<StoredMessage[]>(`/conversation/${convId}/messages`),
}