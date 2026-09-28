// src/api/conversation.ts
import { apiClient } from './client'

/** 后端 /conversation/{id}/messages 的返回形状 */
export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

export const conversationAPI = {
  create: (mode: string = 'llm') =>
    apiClient<{ id: string }>('/conversation/create', {
      method: 'POST',
      body: { title: '新对话', mode },
    }),

  addMessage: (convId: string, role: string, content: string) =>
    apiClient(`/conversation/${convId}/message`, {
      method: 'POST',
      body: { role, content },
    }),

  getMessages: (convId: string) =>
    apiClient<StoredMessage[]>(`/conversation/${convId}/messages`),
}