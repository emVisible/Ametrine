// src/api/conversation.ts
import { apiClient } from './client'

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
    apiClient<any[]>(`/conversation/${convId}/messages`),
}