// src/components/AppLayout.tsx
import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router'
import useAuthStore from '../stores/useAuthStore'
import { useCurrentUser } from '../hooks/useAuth'

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { data: user } = useCurrentUser()
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isActive = (path: string) => {
    if (path === '/dashboard' && location.pathname === '/') return true
    if (path === '/admin') return location.pathname === '/admin'
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }


  const navItems = [
    {
      section: '概览',
      items: [{ path: '/dashboard', label: '仪表盘', icon: '📊' }],
    },
    {
      section: 'AI 对话',
      items: [
        { path: '/chat', label: 'LLM Chat', icon: '💬' },
        { path: '/rag', label: 'RAG Chat', icon: '🔍' },
        { path: '/agent', label: 'Agent Chat', icon: '🤖' }
      ],
    },
    {
      section: '知识库',
      items: [{ path: '/admin/vector', label: '知识库管理', icon: '📚' }],
    },
    {
      section: '系统',
      items: [
        { path: '/profile', label: '个人资料', icon: '👤' },
        { path: '/settings', label: '系统设置', icon: '⚙️' },
      ],
    },
  ]

  if (user?.permissions?.includes('admin')) {
    navItems.splice(3, 0, {
      section: '管理',
      items: [{ path: '/admin', label: '用户管理', icon: '👥' }],
    })
  }

  return (
    <div className="h-screen flex">
      {/* 侧边栏 */}
      <aside
        className={`${sidebarOpen ? 'w-56' : 'w-16'
          } bg-white border-r border-gray-200 flex flex-col transition-all duration-200 flex-shrink-0`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200 flex-shrink-0">
          {sidebarOpen && (
            <span className="font-semibold text-gray-900 text-sm">Ametrine</span>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={
                  sidebarOpen
                    ? 'M11 19l-7-7 7-7m8 14l-7-7 7-7'
                    : 'M13 5l7 7-7 7M5 5l7 7-7 7'
                }
              />
            </svg>
          </button>
        </div>

        {/* 导航菜单 — 可滚动 */}
        <nav className="flex-1 overflow-y-auto py-3">
          {navItems.map((section) => (
            <div key={section.section} className="mb-3">
              {sidebarOpen && (
                <p className="px-4 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  {section.section}
                </p>
              )}
              {section.items.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${isActive(item.path)
                    ? 'bg-indigo-50 text-indigo-700 font-medium border-r-2 border-indigo-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  {sidebarOpen && <span>{item.label}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* 底部用户信息 — 固定 */}
        <div className="border-t border-gray-200 p-3 flex-shrink-0 flex justify-between items-center" >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
              {user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user?.name}
                </p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="mt-2 text-xs text-red-600 hover:text-red-800 text-left"
          >
            {sidebarOpen ? '退出登录' : '🚪'}
          </button>
        </div>
      </aside>

      {/* 主内容区 — 固定高度 + 独立滚动 */}
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}