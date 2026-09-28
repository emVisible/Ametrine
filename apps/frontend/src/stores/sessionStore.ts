// src/stores/sessionStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { conversationAPI } from '../api/converstion'

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  date?: string
}

export interface Session {
  id: string
  title: string
  mode: 'llm' | 'rag' | 'agent'
  messages: HistoryMessage[]
  createdAt: string
  updatedAt: string
}

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null

  // 创建新会话
  createSession: (mode?: 'llm' | 'rag' | 'agent') => Promise<string>
  // 切换会话；null 表示「当前没有会话」—— 裸 /chat、/rag 就是这个状态，
  // 会话要等到首次发送时才建，而不是访问路由就写库
  switchSession: (id: string | null) => void
  // 删除会话
  deleteSession: (id: string) => void
  // 重命名会话
  renameSession: (id: string, title: string) => void
  // 添加消息到当前会话
  addMessage: (message: HistoryMessage) => void
  // 更新最后一条消息（流式追加）
  appendToLastMessage: (content: string) => void
  // 获取当前会话
  getCurrentSession: () => Session | null
  // 获取所有会话列表
  getSessionList: () => Omit<Session, 'messages'>[]
}

const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      createSession: async (mode = 'llm') => {
        // 先在后端创建 Conversation
        let backendId: string
        try {
          const result = await conversationAPI.create(mode)
          // 后端返回结构变化时不能静默产生 undefined ID
          backendId = typeof result?.id === 'string' && result.id
            ? result.id
            : crypto.randomUUID()
        } catch {
          backendId = crypto.randomUUID() // 降级：后端挂了用本地 ID
        }

        const now = new Date().toISOString()
        const newSession: Session = {
          id: backendId,
          title: '新对话',
          mode,
          messages: [],
          createdAt: now,
          updatedAt: now,
        }
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: backendId,
        }))
        return backendId
      },

      switchSession: (id) => {
        set({ currentSessionId: id })
      },

      deleteSession: (id) => {
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== id);
          if (state.currentSessionId !== id) {
            return { sessions, currentSessionId: state.currentSessionId };
          }
          // 后继会话只能同模式：/rag 页面删掉当前会话不该跳到「对话」会话上
          const removed = state.sessions.find((s) => s.id === id);
          const successor =
            sessions.find((s) => s.mode === removed?.mode)?.id ?? null;
          return { sessions, currentSessionId: successor };
        });
      },

      renameSession: (id, title) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title } : s
          ),
        }))
      },
      addMessage: (message) => {
        set((state) => {
          const session = state.sessions.find((s) => s.id === state.currentSessionId)
          if (!session) return state

          // 异步存到后端（不阻塞 UI）
          conversationAPI.addMessage(
            state.currentSessionId!,
            message.role,
            message.content
          ).catch(console.error)

          // 第一条用户消息作为标题
          const isFirstUserMsg =
            message.role === 'user' &&
            session.messages.filter((m) => m.role === 'user').length === 0

          return {
            sessions: state.sessions.map((s) =>
              s.id === state.currentSessionId
                ? {
                  ...s,
                  title: isFirstUserMsg
                    ? message.content.slice(0, 50)
                    : s.title,
                  messages: [
                    ...s.messages,
                    { ...message, date: new Date().toLocaleTimeString('zh-CN') },
                  ],
                  updatedAt: new Date().toISOString(),
                }
                : s
            ),
          }
        })
      },

      appendToLastMessage: (content) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === state.currentSessionId
              ? {
                ...s,
                messages: s.messages.map((m, i, arr) =>
                  i === arr.length - 1 && m.role === 'assistant'
                    ? { ...m, content: m.content + content }
                    : m
                ),
                updatedAt: new Date().toISOString(),
              }
              : s
          ),
        }))
      },

      getCurrentSession: () => {
        const state = get()
        return state.sessions.find((s) => s.id === state.currentSessionId) || null
      },

      getSessionList: () => {
        return get().sessions.map(({ messages, ...rest }) => ({
          ...rest,
          lastMessage: messages.at(-1)?.content?.slice(0, 60) || null,
          messageCount: messages.length,
        }))
      },
    }),
    {
      name: 'chat-sessions',
      partialize: (state) => ({
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
      }),
    }
  )
)

export default useSessionStore