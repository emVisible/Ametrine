import { FormEvent, useMemo, useRef, useState } from 'react'
import { Bot, Boxes, BrainCircuit, Database, Mic, Send, Square, UserRound, Volume2 } from 'lucide-react'
import { synthesizeSpeech, transcribeAudio } from '../api/audio'
import { ChatEvent, ChatMode, streamChat } from '../api/chat'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  references?: Array<Record<string, unknown>>
  toolCalls?: Array<Record<string, unknown>>
}

const modes: Array<{ value: ChatMode; label: string }> = [
  { value: 'llm', label: 'Chat' },
  { value: 'rag', label: 'RAG' },
  { value: 'agent', label: 'Agent' },
]

function createId() {
  return crypto.randomUUID()
}

export function ChatShell() {
  const [mode, setMode] = useState<ChatMode>('llm')
  const [conversationId, setConversationId] = useState<string>()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [databaseName, setDatabaseName] = useState('default')
  const [collectionName, setCollectionName] = useState('default')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string>()
  const abortRef = useRef<AbortController | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<BlobPart[]>([])

  const history = useMemo(
    () =>
      messages
        .slice(-8)
        .filter((message) => message.content.trim())
        .map((message) => ({ role: message.role, content: message.content })),
    [messages],
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return

    const userMessage: Message = { id: createId(), role: 'user', content: text }
    const assistantId = createId()
    const assistantMessage: Message = { id: assistantId, role: 'assistant', content: '' }
    setMessages((current) => [...current, userMessage, assistantMessage])
    setInput('')
    setError(undefined)
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat(
        {
          conversation_id: conversationId,
          mode,
          message: text,
          chat_history: history,
          rag:
            mode === 'rag'
              ? {
                  database_name: databaseName,
                  collection_name: collectionName,
                }
              : undefined,
          options: { stream: true },
        },
        (event) => handleChatEvent(event, assistantId),
        controller.signal,
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message)
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  function handleChatEvent(event: ChatEvent, assistantId: string) {
    if (event.type === 'done') {
      if (event.conversation_id) setConversationId(event.conversation_id)
      return
    }
    if (event.type === 'error') {
      setError(event.message)
      return
    }

    setMessages((current) =>
      current.map((message) => {
        if (message.id !== assistantId) return message
        if (event.type === 'token') {
          return { ...message, content: message.content + event.content }
        }
        if (event.type === 'reference') {
          return { ...message, references: event.data }
        }
        if (event.type === 'tool_call') {
          return { ...message, toolCalls: [...(message.toolCalls ?? []), event.data] }
        }
        return message
      }),
    )
  }

  function stopStreaming() {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop()
      return
    }

    try {
      setError(undefined)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setIsRecording(false)
        try {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          const text = await transcribeAudio(blob)
          setInput((current) => (current ? `${current}\n${text}` : text))
        } catch (err) {
          setError((err as Error).message)
        }
      }
      recorder.start()
      setIsRecording(true)
    } catch (err) {
      setIsRecording(false)
      setError((err as Error).message)
    }
  }

  async function playLatestAssistantMessage() {
    const latest = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
    if (!latest) return
    try {
      setError(undefined)
      const blob = await synthesizeSpeech(latest.content)
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <main className="flex h-screen w-screen bg-[#f7f5ef] text-ink">
      <aside className="flex w-72 shrink-0 flex-col border-r border-black/10 bg-white">
        <div className="border-b border-black/10 px-5 py-4">
          <div className="text-lg font-semibold">Ametrine</div>
          <div className="mt-1 text-xs text-black/50">Local AI workspace</div>
        </div>

        <section className="space-y-4 px-4 py-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-black/45">
              <BrainCircuit size={14} />
              Mode
            </div>
            <div className="grid grid-cols-3 rounded-md border border-black/10 bg-mist p-1">
              {modes.map((item) => (
                <button
                  key={item.value}
                  className={`h-8 rounded text-sm transition ${
                    mode === item.value ? 'bg-white text-ink shadow-sm' : 'text-black/55 hover:text-ink'
                  }`}
                  type="button"
                  onClick={() => setMode(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase text-black/45">
              <Database size={14} />
              Database
            </label>
            <input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} className="field" />
            <label className="flex items-center gap-2 text-xs font-medium uppercase text-black/45">
              <Boxes size={14} />
              Collection
            </label>
            <input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} className="field" />
          </div>
        </section>

        <div className="mt-auto border-t border-black/10 px-4 py-3 text-xs leading-5 text-black/45">
          所有新交互都走统一 <code>/api/chat</code> 契约。语音能力会接到后端 audio adapter。
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center border-b border-black/10 bg-white px-5">
          <div className="mr-auto text-sm text-black/55">
            {conversationId ? `Conversation ${conversationId.slice(0, 8)}` : 'New conversation'}
          </div>
          <button
            className={`icon-button ${isRecording ? 'border-red-300 text-red-600' : ''}`}
            type="button"
            title={isRecording ? 'Stop recording' : 'Record voice input'}
            onClick={toggleRecording}
          >
            <Mic size={18} />
          </button>
          <button className="icon-button" type="button" title="Play latest reply" onClick={playLatestAssistantMessage}>
            <Volume2 size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-black/45">
              <div>
                <Bot className="mx-auto mb-3 text-ametrine" size={40} />
                <div className="text-base font-medium text-black/70">开始一段对话</div>
                <div className="mt-1 text-sm">Chat、RAG 和 Agent 会在同一条流式协议下返回。</div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {messages.map((message) => (
                <article key={message.id} className="flex gap-3">
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-black/55">
                    {message.role === 'user' ? <UserRound size={17} /> : <Bot size={17} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-xs uppercase text-black/35">{message.role}</div>
                    <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
                      {message.content || (message.role === 'assistant' && isStreaming ? '...' : '')}
                    </div>
                    {Boolean(message.toolCalls?.length) && (
                      <div className="mt-3 border-l-2 border-river/40 pl-3 text-xs text-black/55">
                        {message.toolCalls?.map((toolCall, index) => (
                          <div key={index}>{JSON.stringify(toolCall)}</div>
                        ))}
                      </div>
                    )}
                    {Boolean(message.references?.length) && (
                      <div className="mt-3 border-l-2 border-ametrine/50 pl-3 text-xs text-black/55">
                        References: {message.references?.map((item) => String(item.title ?? item.source ?? 'source')).join(', ')}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {error && <div className="border-t border-red-200 bg-red-50 px-8 py-2 text-sm text-red-700">{error}</div>}

        <form className="border-t border-black/10 bg-white px-6 py-4" onSubmit={handleSubmit}>
          <div className="mx-auto flex max-w-4xl items-end gap-2">
            <textarea
              className="min-h-[48px] flex-1 resize-none rounded-md border border-black/10 bg-[#fbfaf7] px-3 py-3 text-sm outline-none transition focus:border-ametrine"
              placeholder="想了解点什么"
              value={input}
              rows={1}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            {isStreaming ? (
              <button className="send-button bg-ink" type="button" onClick={stopStreaming} title="Stop">
                <Square size={18} />
              </button>
            ) : (
              <button className="send-button bg-ametrine" type="submit" title="Send">
                <Send size={18} />
              </button>
            )}
          </div>
        </form>
      </section>
    </main>
  )
}
