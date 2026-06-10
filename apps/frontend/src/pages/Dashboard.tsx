// src/pages/Dashboard.tsx
import { useNavigate } from 'react-router'
import { useCurrentUser } from '../hooks/useAuth'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import { databaseAPI } from '../api/rag'
import type { UserListResponse } from '../types/user'

export default function Dashboard() {
  const { data: user } = useCurrentUser()
  const navigate = useNavigate()

  // 获取统计信息
  const { data: usersData } = useQuery<UserListResponse>({
    queryKey: ['users'],
    queryFn: () => apiClient<any>('/user/all'),
    enabled: !!user?.permissions?.includes('admin'),
  })

  const { data: databases } = useQuery({
    queryKey: ['pg-databases'],
    queryFn: databaseAPI.getAll,
  })

  const quickLinks = [
    { label: 'LLM Chat', desc: 'AI 对话', path: '/chat', icon: '💬', color: 'indigo' },
    { label: 'RAG Chat', desc: '知识库检索', path: '/rag', icon: '🔍', color: 'green' },
    { label: '知识库', desc: '管理文档', path: '/admin/vector', icon: '📚', color: 'blue' },
    { label: '个人资料', desc: '查看信息', path: '/profile', icon: '👤', color: 'purple' },
    { label: '系统设置', desc: '偏好配置', path: '/settings', icon: '⚙️', color: 'gray' },
  ]

  // admin 专属入口
  if (user?.permissions?.includes('admin')) {
    quickLinks.push({ label: '用户管理', desc: '后台管理', path: '/admin', icon: '👥', color: 'red' })
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* 欢迎区 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">欢迎回来，{user?.name}</h1>
          <p className="text-gray-500 mt-1">今天是 {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="知识库" value={databases?.length || 0} icon="📚" color="blue" />
          <StatCard label="LLM 对话" value="—" icon="💬" color="indigo" />
          <StatCard label="今日用量" value={`${user?.daily_token_used?.toLocaleString() || 0} tokens`} icon="⚡" color="yellow" />
          {user?.permissions?.includes('admin') && (
            <StatCard label="用户总数" value={usersData?.total || 0} icon="👥" color="green" />
          )}
        </div>

        {/* 快捷入口 */}
        <h2 className="text-lg font-semibold text-gray-900 mb-4">快捷入口</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickLinks.map((link) => (
            <button
              key={link.path}
              onClick={() => navigate(link.path)}
              className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:shadow-md hover:border-gray-300 transition-all group"
            >
              <span className="text-2xl">{link.icon}</span>
              <h3 className="font-semibold text-gray-900 mt-2">{link.label}</h3>
              <p className="text-sm text-gray-500 mt-0.5">{link.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    green: 'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg ${colorMap[color] || 'bg-gray-50 text-gray-600'} flex items-center justify-center text-lg`}>
          {icon}
        </div>
      </div>
    </div>
  )
}