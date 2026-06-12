// src/components/AppLayout.tsx
import { useState, useCallback } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router'
import useAuthStore from '../stores/useAuthStore'
import useSessionStore from '../stores/sessionStore'
import { useCurrentUser } from '../hooks/useAuth'

interface NavItem {
  path: string
  label: string
  icon: string
}

export default function AppLayout() {
  const { data: user } = useCurrentUser()
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()
  const location = useLocation()

  const sessions = useSessionStore((s) => s.sessions)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const createSession = useSessionStore((s) => s.createSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)

  const [activeMode, setActiveMode] = useState<'llm' | 'rag' | 'agent'>('llm')
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const handleLogout = useCallback(() => {
    logout()
    navigate('/login')
  }, [logout, navigate])

  const handleNewChat = useCallback((mode: 'llm' | 'rag' | 'agent' = 'llm') => {
    const id = createSession(mode)
    const routeMap = { llm: 'chat', rag: 'rag', agent: 'agent' }
    navigate(`/${routeMap[mode]}/${id}`, { replace: true })
  }, [createSession, navigate])
  

  const handleDeleteSession = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteSession(id)
  }, [deleteSession])

  const modeLabels: Record<string, string> = {
    llm: 'LLM 对话',
    rag: 'RAG 检索',
    agent: 'Agent 助手',
  }

  const modeIcons: Record<string, string> = {
    llm: '💬',
    rag: '🔍',
    agent: '🤖',
  }

  const modeNavItems = [
    { mode: 'llm' as const, label: modeLabels.llm, icon: modeIcons.llm },
    { mode: 'rag' as const, label: modeLabels.rag, icon: modeIcons.rag },
    { mode: 'agent' as const, label: modeLabels.agent, icon: modeIcons.agent },
  ]

  const otherNavItems: NavItem[] = [
    { path: '/dashboard', label: '仪表盘', icon: '📊' },
    { path: '/admin/vector', label: '知识库', icon: '📚' },
  ]

  if (user?.permissions?.includes('admin')) {
    otherNavItems.push({ path: '/admin', label: '用户管理', icon: '👥' })
  }

  // 当前模式的会话
  const filteredSessions = sessions.filter((s) => s.mode === activeMode)

  return (
    <div className="h-screen flex flex-col">
      {/* ═══ 顶部 Header ═══ */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center px-4 flex-shrink-0 z-10">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <img src="/src/assets/icon.png" alt="" className="w-6 h-6" />
          <span className="font-semibold text-gray-900 text-sm">Ametrine</span>
        </div>

        {/* 右侧导航 + 用户信息 */}
        <div className="flex items-center gap-2 ml-auto">
          <nav className="flex items-center gap-1">
            {otherNavItems.map((item) => {
              const isActive =
                location.pathname === item.path ||
                location.pathname.startsWith(item.path + '/')
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${isActive
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                    }`}
                >
                  <span className="text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="relative ml-2">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-medium">
                {user?.name?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <span className="text-xs text-gray-700 hidden sm:block">{user?.name}</span>
              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {userMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  {/* 用户信息 */}
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                  </div>

                  {/* 资料 */}
                  <button
                    onClick={() => { navigate('/profile'); setUserMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span>👤</span>
                    个人资料
                  </button>

                  {/* 设置 */}
                  <button
                    onClick={() => { navigate('/settings'); setUserMenuOpen(false) }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span>⚙️</span>
                    系统设置
                  </button>

                  <div className="border-t border-gray-100" />

                  {/* 退出 */}
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <span>🚪</span>
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>

        </div>
      </header>

      {/* ═══ 主体 ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧历史栏 */}
        <aside className="w-56 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
          {/* 新对话按钮 + 模式选择 */}
          <div className="p-3 border-b border-gray-100 space-y-2">
            <button
              onClick={() => handleNewChat(activeMode)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              新对话
            </button>

            {/* 模式切换 — 带文字说明 */}
            <div className="flex gap-1">
              {modeNavItems.map((item) => {
                const isActive = activeMode === item.mode
                return (
                  <button
                    key={item.mode}
                    onClick={() => {
                      setActiveMode(item.mode)
                      // 如果当前在某个对话页，切换到对应模式的路由
                      const routeMap: Record<string, string> = {
                        llm: 'chat', rag: 'rag', agent: 'agent',
                      }
                      const currentModeSessions = sessions.filter((s) => s.mode === item.mode)
                      if (currentModeSessions.length > 0) {
                        // 有历史对话，切换到最近一条
                        const latest = currentModeSessions[0]
                        useSessionStore.getState().switchSession(latest.id)
                        navigate(`/${routeMap[item.mode]}/${latest.id}`, { replace: true })
                      } else {
                        // 没有历史对话，新建
                        handleNewChat(item.mode)
                      }
                    }}
                    className={`flex-1 flex flex-col items-center py-1.5 rounded text-[10px] transition-colors ${isActive
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                      }`}
                  >
                    <span className="text-sm mb-0.5">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 历史列表 */}
          <div className="flex-1 overflow-y-auto">
            {filteredSessions.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">
                暂无历史记录
              </p>
            ) : (
              <div className="py-1">
                {filteredSessions.slice(0, 100).map((s) => (
                  <div key={s.id} className="group relative">
                    <button
                      onClick={() => {
                        useSessionStore.getState().switchSession(s.id)
                        const routeMap: Record<string, string> = {
                          llm: 'chat',
                          rag: 'rag',
                          agent: 'agent',
                        }
                        navigate(`/${routeMap[s.mode]}/${s.id}`, {
                          replace: true,
                        })
                      }}
                      className={`w-full text-left px-3 py-2 transition-colors ${currentSessionId === s.id
                        ? 'bg-indigo-50 border-r-2 border-indigo-600'
                        : 'hover:bg-gray-50'
                        }`}
                    >
                      <span
                        className={`text-xs truncate block ${currentSessionId === s.id
                          ? 'text-indigo-700 font-medium'
                          : 'text-gray-700'
                          }`}
                      >
                        {s.title || '新对话'}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">
                          {s.messages.length} 条
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {new Date(s.updatedAt).toLocaleDateString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      className="absolute right-2 top-2 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-600 transition-all"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* 右侧主内容 */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}