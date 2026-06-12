// src/pages/Admin.tsx
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../api/client'
import type { User, UserListResponse } from '../types/user'


export default function AdminPage() {
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const { data: result, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient<UserListResponse>('/user/all'),
  })
  const users = result?.users || []


  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="总用户数"
            value={users?.length || 0}
            color="blue"
          />
          <StatCard
            title="管理员"
            value={users?.filter((u) => u.role_id === 3).length || 0}
            color="purple"
          />
          <StatCard
            title="经理"
            value={users?.filter((u) => u.role_id === 2).length || 0}
            color="green"
          />
          <StatCard
            title="普通用户"
            value={users?.filter((u) => u.role_id === 1).length || 0}
            color="gray"
          />
        </div>

        {/* 用户列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">用户管理</h2>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      用户名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      邮箱
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      角色
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                    <th className="px-6 py-3 ...">状态</th>
                    <th className="px-6 py-3 ...">已用 Token</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users?.map((user) => (
                    <tr
                      key={user.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {user.id}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {user.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {user.email}
                      </td>
                      <td className="px-6 py-4">
                        <RoleBadge roleId={user.role_id} />
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          查看详情
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${user.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                          }`}>
                          {user.is_active ? '活跃' : '禁用'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {user.total_token_used?.toLocaleString() || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 用户详情弹窗 */}
        {selectedUser && (
          <UserDetailModal
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
          />
        )}
      </main>
    </div>
  )
}

// 统计卡片组件
function StatCard({
  title,
  value,
  color,
}: {
  title: string
  value: number
  color: 'blue' | 'green' | 'purple' | 'gray'
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    purple: 'bg-purple-50 text-purple-700',
    gray: 'bg-gray-50 text-gray-700',
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${colorMap[color]}`}>
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        </div>
      </div>
    </div>
  )
}

// 角色标签组件
function RoleBadge({ roleId }: { roleId: number }) {
  const roleMap: Record<number, { label: string; color: string }> = {
    1: { label: '用户', color: 'bg-gray-100 text-gray-700' },
    2: { label: '经理', color: 'bg-green-100 text-green-700' },
    3: { label: '管理员', color: 'bg-purple-100 text-purple-700' },
  }

  const role = roleMap[roleId] || { label: '未知', color: 'bg-gray-100 text-gray-700' }

  return (
    <span
      className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${role.color}`}
    >
      {role.label}
    </span>
  )
}

// 用户详情弹窗
function UserDetailModal({
  user,
  onClose,
}: {
  user: User
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">用户详情</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <DetailRow label="ID" value={user.id} />
          <DetailRow label="用户名" value={user.name} />
          <DetailRow label="邮箱" value={user.email} />
          <DetailRow label="角色" value={<RoleBadge roleId={user.role_id} />} />
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: string | number | React.ReactNode
}) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}