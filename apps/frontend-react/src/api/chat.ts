import { postJson } from './client'

export type ChatMode = 'llm' | 'rag' | 'agent'

export type ChatRequest = {
  conversation_id?: string
  mode: ChatMode
  message: string
  chat_history?: Array<{ role: string; content: string }>
  rag?: {
    database_name: string
    collection_name: string
  }
  options?: {
    stream: boolean
    voice_reply?: boolean
  }
}

export type ChatEvent =
  | { type: 'token'; content: string }
  | { type: 'reference'; data: Array<Record<string, unknown>> }
  | { type: 'tool_call'; data: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done'; conversation_id?: string }

export async function streamChat(
  request: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
) {
  const response = await postJson('/api/chat', request, signal)
  if (!response.body) throw new Error('Streaming response is empty.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('')

      if (!data) continue
      onEvent(JSON.parse(data) as ChatEvent)
    }
  }

  if (buffer.trim()) {
    const data = buffer.replace(/^data:\s?/, '').trim()
    if (data) onEvent(JSON.parse(data) as ChatEvent)
  }
}
