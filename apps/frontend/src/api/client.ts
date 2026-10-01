// src/api/client.ts
import useAuthStore from "../stores/useAuthStore"
import { t } from "../i18n"
import { API_BASE } from './base'

interface RequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

/** 401 用类型而不是字符串来识别，避免调用方靠 message.includes('401') 猜。 */
export class UnauthorizedError extends Error {
  constructor() {
    super(t('errors.unauthorized'))
    this.name = 'UnauthorizedError'
  }
}

export async function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = options

  const token = useAuthStore.getState().token

  const config: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  }

  if (body && method !== 'GET') {
    config.body = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE}${endpoint}`, config)

  if (response.status === 401) {
    // token 过期：清掉登录态即可，ProtectedRoute 订阅同一 store 会完成跳转，
    // 不需要 window.location 整页刷新（那会丢掉 SPA 已加载的状态）
    useAuthStore.getState().logout()
    throw new UnauthorizedError()
  }

  if (!response.ok) {
    // 只读一次 body：先按文本取，再尝试解析出后端两种错误形状
    // （自建端点的 {code,message,data} 与 FastAPI 校验器的 {detail}）
    const raw = await response.text().catch(() => '')
    let message = raw
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { message?: unknown; detail?: unknown }
        const text = [parsed.message, parsed.detail].find((v) => typeof v === 'string')
        if (text) message = text
      } catch {
        /* 不是 JSON，原样透出 */
      }
    }
    throw new Error(message || t('errors.fallback', { status: response.status }))
  }

  const result: ApiResponse<T> = await response.json()
  return result.data
}