import useAuthStore from "../stores/useAuthStore"

// src/api/agent.ts
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api'

interface AgentEvent {
  type: 'text' | 'tool_call' | 'thought' | 'done'
  content?: string
  tool?: string
  input?: string
}

export async function streamAgent(
  query: string,
  onText: (text: string) => void,
  onToolCall: (tool: string, input: string) => void,
  onThought: (thought: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
): Promise<void> {
  const formData = new URLSearchParams()
  formData.append('query', query)

  const token = localStorage.getItem('auth-storage')
    ? JSON.parse(localStorage.getItem('auth-storage')!).state?.token
    : null

  const response = await fetch(`${API_BASE}/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  })
  if (response.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = '/login'
    throw new Error('登录已过期，请重新登录')
  }
  if (!response.ok) {
    throw new Error(`Agent 请求失败: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    onError(new Error('浏览器不支持流式读取'))
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event: AgentEvent = JSON.parse(line)

          switch (event.type) {
            case 'text':
              if (event.content) onText(event.content)
              break
            case 'tool_call':
              if (event.tool) onToolCall(event.tool, event.input || '')
              break
            case 'thought':
              if (event.content) onThought(event.content)
              break
            case 'done':
              onComplete()
              break
          }
        } catch {
          // 非 JSON 行跳过
        }
      }
    }
  } catch (error) {
    onError(error instanceof Error ? error : new Error('流读取失败'))
  }
}