// src/pages/Profile.tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '../hooks/useAuth'
import { apiClient } from '../api/client'
import useAuthStore from '../stores/useAuthStore'
import type { User } from '../types/user'

export default function ProfilePage() {
  const { data: currentUser } = useCurrentUser()
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const queryClient = useQueryClient()

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState<Partial<User>>({})
  const [message, setMessage] = useState('')

  // 获取完整用户信息
  const { data: fullUser, isLoading } = useQuery({
    queryKey: ['user', user?.id],
    queryFn: () => apiClient<User>(`/user/${user?.id}`),
    enabled: !!user?.id && !!token,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<User>) =>
      apiClient(`/user/${user?.id}`, { method: 'PATCH', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', user?.id] })
      setIsEditing(false)
      setMessage('保存成功')
      setTimeout(() => setMessage(''), 3000)
    },
    onError: (error: Error) => {
      setMessage(`保存失败: ${error.message}`)
    },
  })

  const startEdit = () => {
    if (fullUser) {
      setFormData({
        name: fullUser.name,
        email: fullUser.email || '',
        system_prompt: fullUser.system_prompt || '',
      })
    }
    setIsEditing(true)
  }

  const handleSave = () => {
    updateMutation.mutate(formData)
  }

  const roleNames: Record<number, string> = { 1: '用户', 2: '经理', 3: '管理员' }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">个人资料</h1>
          {!isEditing ? (
            <button onClick={startEdit} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              编辑资料
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setIsEditing(false)} className="px-4 py-2 border border-gray-300 text-sm rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button onClick={handleSave} disabled={updateMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50">
                {updateMutation.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          )}
        </div>

        {message && (
          <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${message.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message}
          </div>
        )}

        {/* 基本信息卡片 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">基本信息</h2>
          <div className="space-y-4">
            <ProfileField label="用户名" value={fullUser?.name} editing={isEditing}
              editValue={formData.name || ''} onChange={(v) => setFormData({ ...formData, name: v })} />
            <ProfileField label="邮箱" value={fullUser?.email || '未设置'} editing={isEditing}
              editValue={formData.email || ''} onChange={(v) => setFormData({ ...formData, email: v })} />
            <ProfileField label="角色" value={roleNames[fullUser?.role_id || 1]} />
            <ProfileField label="注册时间" value={fullUser?.created_at?.slice(0, 10) || '—'} />
            <ProfileField label="最后登录" value={fullUser?.last_login_at?.slice(0, 10) || '—'} />
            <ProfileField label="状态" value={fullUser?.is_active ? '活跃' : '禁用'} />
          </div>
        </div>

        {/* 权限卡片 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">权限信息</h2>
          <div className="flex flex-wrap gap-2">
            {currentUser?.permissions?.map((perm: string) => (
              <span key={perm} className="px-3 py-1 text-sm font-medium bg-indigo-100 text-indigo-700 rounded-full">
                {perm}
              </span>
            )) || <span className="text-sm text-gray-500">暂无权限</span>}
          </div>
        </div>

        {/* 用量卡片 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">使用统计</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UsageStat label="日用量" value={fullUser?.daily_token_used || 0} limit={fullUser?.daily_token_limit || 100000} />
            <UsageStat label="月用量" value={fullUser?.monthly_token_used || 0} limit={fullUser?.monthly_token_limit || 3000000} />
            <UsageStat label="总用量" value={fullUser?.total_token_used || 0} />
            <UsageStat label="日限额" value={fullUser?.daily_token_limit || 100000} />
          </div>
        </div>

        {/* 系统提示词 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Agent 个性化</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">系统提示词</label>
            {isEditing ? (
              <textarea
                value={formData.system_prompt || ''}
                onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                rows={4}
                placeholder="自定义 AI 助手的系统提示词..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            ) : (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 min-h-[60px] whitespace-pre-wrap">
                {fullUser?.system_prompt || '未设置（使用默认系统提示词）'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ProfileField({ label, value, editing, editValue, onChange }: {
  label: string
  value?: string
  editing?: boolean
  editValue?: string
  onChange?: (v: string) => void
}) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      {editing && onChange ? (
        <input
          value={editValue}
          onChange={(e) => onChange(e.target.value)}
          className="text-sm text-right border border-gray-300 rounded px-2 py-1 w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      ) : (
        <span className="text-sm font-medium text-gray-900">{value || '—'}</span>
      )}
    </div>
  )
}

function UsageStat({ label, value, limit }: { label: string; value: number; limit?: number }) {
  const percent = limit ? Math.min(100, Math.round((value / limit) * 100)) : 0
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value.toLocaleString()}</p>
      {limit && (
        <div className="mt-1">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">{percent}%</p>
        </div>
      )}
    </div>
  )
}