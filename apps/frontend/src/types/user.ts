// src/types/user.ts
export interface User {
  id: number
  name: string
  email: string | null
  avatar_url: string | null
  is_active: boolean
  role_id: number
  tenant_id: number | null
  preferences: Record<string, unknown> | null
  system_prompt: string | null
  daily_token_used: number
  daily_token_limit: number
  monthly_token_used: number
  monthly_token_limit: number
  total_token_used: number
  created_at: string
  last_login_at: string | null
}

export interface CurrentUser {
  id: number
  name: string
  email: string
  permissions: string[]
  daily_token_used: number
  daily_token_limit: number
}

export interface UserListResponse {
  users: User[]
  total: number
  offset: number
  limit: number
}