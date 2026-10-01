// src/stores/sessionStore.ts
// 会话消息的唯一事实源。
//
// 所有写入动作都以**会话 id** 定位，绝不读「当前显示的是哪条会话」：
// 流式回调可能在用户切走之后才到达，按 currentSessionId 写入会把 A 会话的回复
// 灌进正在显示的 B 会话（就是「切了 session 就在别的会话里渲染当前回复」的根因）。
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { conversationAPI } from '../api/converstion'

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  date?: string
  /** 服务端 message 表的 id。反馈与状态都要挂在它身上，
   *  没有它就等于界面上任何「给这条回答打分」的动作只能写在浏览器里。 */
  serverId?: string
  /** 服务端推导的回答状态：done / no_reference / failed */
  status?: string
}

export interface Session {
  id: string
  /** 空字符串 = 还没命名，展示层用 i18n 的「新对话」文案补 */
  title: string
  /** 与后端 ChatRequest.mode 一一对应：'agent' 已删 —— 后端没有 agent 运行时，
   *  带它请求会 422，界面上也就没有任何入口能产出这种会话。 */
  mode: 'llm' | 'rag'
  messages: HistoryMessage[]
  createdAt: string
  updatedAt: string
}

interface SessionState {
  sessions: Session[]
  currentSessionId: string | null

  createSession: (mode?: 'llm' | 'rag') => Promise<string>
  // 切换会话；null 表示「当前没有会话」—— 裸 /chat、/rag 就是这个状态，
  // 会话要等到首次发送时才建，而不是访问路由就写库
  switchSession: (id: string | null) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void

  /** 追加一轮「用户提问 + 空的助手气泡」，返回发起前的历史快照（送给模型当上下文）。 */
  beginTurn: (id: string, prompt: string) => HistoryMessage[]
  /** 把 token 追加到该会话最后一条助手消息；没有就补一个气泡（重连/回填场景）。 */
  appendToken: (id: string, token: string) => void
  /** 收尾补丁：给最后一条助手消息补元数据（如引用来源）。 */
  patchLast: (id: string, patch: Record<string, unknown>) => void
  /** 失败时丢弃空的助手气泡，避免留下空气泡与污染后续历史。 */
  discardEmptyTurn: (id: string) => void
  setMessages: (id: string, messages: HistoryMessage[]) => void

  getCurrentSession: () => Session | null
  getSessionList: () => Omit<Session, 'messages'>[]
}

const nowIso = () => new Date().toISOString();

/** 在不可变更新里改某条会话；找不到就原样返回（后台流写到已删除的会话时应静默）。 */
function editSession(
  sessions: Session[],
  id: string,
  fn: (s: Session) => Session,
): Session[] {
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return sessions
  const current = sessions[idx]
  if (!current) return sessions
  const next = sessions.slice()
  next[idx] = fn(current)
  return next
}

const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,

      createSession: async (mode = 'llm') => {
        // 单例节流：已经有一条「没写过内容、也没改过名」的空白会话，就回到它身上。
        // 连点 + 不该攒出多条「新对话」，更不该往库里多写几条空 Conversation
        // （后端行是这里立刻建的，所以重复点击的代价是一条删不掉也打不开的记录）。
        // 一旦用户改过名或发过消息，它就不再是草稿，此时才允许另开一条。
        const blank = get().sessions.find(
          (s) => s.mode === mode && s.messages.length === 0 && !s.title,
        )
        if (blank) {
          if (get().currentSessionId !== blank.id) set({ currentSessionId: blank.id })
          return blank.id
        }

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
          title: '',
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

      switchSession: (id) => set({ currentSessionId: id }),

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
        const before = get().sessions.find((s) => s.id === id)?.title
        if (before === title) return
        set((state) => ({
          sessions: editSession(state.sessions, id, (s) => ({ ...s, title })),
        }))
        // 手动改名同样要落库，否则下次进来又变回自动命名
        conversationAPI.rename(id, title).catch(() => {})
      },

      beginTurn: (id, prompt) => {
        const session = get().sessions.find((s) => s.id === id)
        const history = (session?.messages ?? [])
          .filter((m) => m.content)
          .map((m) => ({ role: m.role, content: m.content }))
        const now = nowIso()
        const named = !session?.title
        const title = (session?.title || prompt).slice(0, 40)
        set((state) => ({
          sessions: editSession(state.sessions, id, (s) => ({
            ...s,
            // 第一条用户消息即会话标题：以前靠页面侧的 effect 补，
            // 那个 effect 绑在「正在显示的会话」上，切走就漏命名
            title: s.title || prompt.slice(0, 40),
            messages: [
              ...s.messages,
              { role: 'user', content: prompt, date: now },
              { role: 'assistant', content: '' },
            ],
            updatedAt: now,
          })),
        }))
        // 命名同时写回服务端：否则标题只活在这台浏览器的 localStorage 里，
        // 换设备或清缓存后，侧栏再也认不出这些对话是什么（后端也有 PATCH 端点，只是以前没人调）
        if (session && named) conversationAPI.rename(id, title).catch(() => {})
        return history
      },

      appendToken: (id, token) =>
        set((state) => ({
          sessions: editSession(state.sessions, id, (s) => {
            const messages = s.messages.slice()
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant') {
              messages[messages.length - 1] = {
                ...last,
                content: last.content + token,
              }
            } else {
              messages.push({ role: 'assistant', content: token })
            }
            return { ...s, messages, updatedAt: nowIso() }
          }),
        })),

      patchLast: (id, patch) =>
        set((state) => ({
          sessions: editSession(state.sessions, id, (s) => {
            const messages = s.messages.slice()
            const last = messages[messages.length - 1]
            if (last?.role !== 'assistant') return s
            messages[messages.length - 1] = { ...last, ...patch }
            return { ...s, messages, updatedAt: nowIso() }
          }),
        })),

      discardEmptyTurn: (id) =>
        set((state) => ({
          sessions: editSession(state.sessions, id, (s) => {
            const last = s.messages[s.messages.length - 1]
            if (last?.role !== 'assistant' || last.content) return s
            return { ...s, messages: s.messages.slice(0, -1), updatedAt: nowIso() }
          }),
        })),

      setMessages: (id, messages) =>
        set((state) => ({
          sessions: editSession(state.sessions, id, (s) => ({
            ...s,
            messages,
            updatedAt: s.updatedAt,
          })),
        })),

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
      // 旧版本把默认标题写死成中文字面量，双语之后它必须是「未命名」这个语义空位
      version: 1,
      migrate: (persisted) => {
        const state = persisted as { sessions?: Session[] } | undefined
        if (!state?.sessions) return state as SessionState
        return {
          ...state,
          sessions: state.sessions.map((s) =>
            s.title === '新对话' ? { ...s, title: '' } : s,
          ),
        }
      },
      partialize: (state) => ({
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
      }),
    }
  )
)

export default useSessionStore
