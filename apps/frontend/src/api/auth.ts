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
      const error = await res.json().catch(() => ({ message: '登录失败' }))
      throw new Error(error.message || `HTTP ${res.status}`)
    }

    return await res.json()
  },

  getCurrentUser: () => apiClient<CurrentUser>('/current'),
}