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
  // 用量三项由服务端**现算**后填进响应（与 /api/current 同一口径）。
  // 以前它们读的是 user 表上三列「有人读、没人写」的死字段，
  // 所以设置页与个人主页的用量条对谁都是 0。
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