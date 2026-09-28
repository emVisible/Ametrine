// src/api/auth.ts
import type { CurrentUser } from '../types/user'
import { apiClient } from './client'
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api'

interface LoginRequest {
  username: string
  password: string
}

interface LoginResponse {
  access_token: string
  token_type: string
}

export const authAPI = {
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const formData = new URLSearchParams()
    formData.append('username', data.username)
    formData.append('password', data.password)

    const res = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData,
    })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      let detail = raw
      try {
        const parsed = JSON.parse(raw) as { detail?: unknown }
        if (typeof parsed?.detail === 'string') detail = parsed.detail
      } catch {
        /* 非 JSON 时原样透出 */
      }
      // 后端会区分「用户不存在」与「密码错误」，那是用户枚举的口子；
      // 前端不给它露出来的机会，统一措辞，其他故障仍然如实报
      if (/not found|incorrect|invalid|unauthorized/i.test(detail)) {
        throw new Error('用户名或密码不正确')
      }
      throw new Error(detail || `登录失败（HTTP ${res.status}）`)
    }

    return await res.json()
  },

  getCurrentUser: () => apiClient<CurrentUser>('/current'),
}