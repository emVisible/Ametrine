// src/pages/Settings.tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import useAuthStore from '../stores/useAuthStore'
import type { User } from '../types/user'

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const queryClient = useQueryClient()

  const [preferences, setPreferences] = useState<Record<string, any>>({})
  const [message, setMessage] = useState('')

  const { data: fullUser } = useQuery<User>({
    queryKey: ['user', user?.id],
    queryFn: () => apiClient<User>(`/user/${user?.id}`),
    enabled: !!user?.id && !!token,
  })

  // 替代 onSuccess
  useEffect(() => {
    if (fullUser?.preferences) {
      setPreferences(fullUser.preferences)
    }
  }, [fullUser])

  const updateMutation = useMutation({
    mutationFn: (data: Partial<User>) =>
      apiClient(`/user/${user?.id}`, { method: 'PATCH', body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', user?.id] })
      setMessage('设置已保存')
      setTimeout(() => setMessage(''), 3000)
    },
    onError: (error: Error) => {
      setMessage(`保存失败: ${error.message}`)
    },
  })

  const updatePreference = (key: string, value: any) => {
    const updated = { ...preferences, [key]: value }
    setPreferences(updated)
  }

  const savePreferences = () => {
    updateMutation.mutate({ preferences })
  }

  const updateTokenLimit = (field: 'daily_token_limit' | 'monthly_token_limit', value: number) => {
    updateMutation.mutate({ [field]: value })
  }

  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-6">系统设置</h1>

        {message && (
          <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-green-50 text-green-700">{message}</div>
        )}

        {/* 偏好设置 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">偏好设置</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">默认回复语言</p>
                <p className="text-xs text-gray-500">AI 回复时使用的语言</p>
              </div>
              <select
                value={preferences.language || 'zh'}
                onChange={(e) => updatePreference('language', e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="auto">自动</option>
              </select>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">默认模型</p>
                <p className="text-xs text-gray-500">对话时使用的 LLM 模型</p>
              </div>
              <select
                value={preferences.model || 'default'}
                onChange={(e) => updatePreference('model', e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="default">系统默认</option>
                <option value="qwen">Qwen</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </div>

            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">主题</p>
                <p className="text-xs text-gray-500">界面颜色主题</p>
              </div>
              <select
                value={preferences.theme || 'light'}
                onChange={(e) => updatePreference('theme', e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
          </div>
          <button
            onClick={savePreferences}
            disabled={updateMutation.isPending}
            className="mt-6 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? '保存中...' : '保存偏好'}
          </button>
        </div>

        {/* Token 配额 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">用量配额</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                每日 Token 限额（当前: {fullUser?.daily_token_limit?.toLocaleString()}）
              </label>
              <div className="flex gap-2">
                {[50000, 100000, 200000, 500000].map((limit) => (
                  <button
                    key={limit}
                    onClick={() => updateTokenLimit('daily_token_limit', limit)}
                    className={`px-3 py-1.5 text-xs rounded-lg border ${
                      fullUser?.daily_token_limit === limit
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {limit.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                每月 Token 限额（当前: {fullUser?.monthly_token_limit?.toLocaleString()}）
              </label>
              <div className="flex gap-2">
                {[1000000, 3000000, 5000000, 10000000].map((limit) => (
                  <button
                    key={limit}
                    onClick={() => updateTokenLimit('monthly_token_limit', limit)}
                    className={`px-3 py-1.5 text-xs rounded-lg border ${
                      fullUser?.monthly_token_limit === limit
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {limit.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}