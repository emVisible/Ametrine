// src/api/chat.ts
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api'

interface StreamMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  prompt: string
  chat_history: StreamMessage[]
}

interface RAGRequest extends ChatRequest {
  database_name: string
  collection_name: string
}


// LLM 普通对话
export async function streamChat(
  dto: ChatRequest,
  onToken: (token: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  await readStream(response, onToken, onComplete, onError)
}

// RAG 检索对话
export async function streamRAG(
  dto: RAGRequest,
  onToken: (token: string) => void,
  onComplete: (references?: unknown[]) => void,
  onError: (error: Error) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/llm/rag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  // 获取引用（从 X-Session-ID 响应头）
  const sessionId = response.headers.get('X-Session-ID')
  let references: unknown[] = []

  if (sessionId) {
    try {
      const refResponse = await fetch(`${API_BASE}/llm/references?session_id=${sessionId}`)
      const result = await refResponse.json()
      references = result.data || result

    } catch {
      // 获取引用失败不影响主流程
    }
  }

  await readStream(response, onToken, () => onComplete(references), onError)
}

// 通用的 SSE 流读取
async function readStream(
  response: Response,
  onToken: (token: string) => void,
  onComplete: () => void,
  onError: (error: Error) => void,
): Promise<void> {
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
      // 最后一行可能不完整，保留到下次
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const token = JSON.parse(line)
          if (token) {
            onToken(token)
          }
        } catch {
          // 非 JSON 行（比如空行），跳过
        }
      }
    }
    onComplete()
  } catch (error) {
    onError(error instanceof Error ? error : new Error('读取流失败'))
  }
}