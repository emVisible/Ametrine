// src/pages/Chat.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { streamChat } from '../api/chat'
import Markdown from '../components/Markdown'
import VoiceInput from '../components/VoiceInput'
import SpeakButton from '../components/SpeakButton'
import useSessionStore, { type HistoryMessage } from '../stores/sessionStore'
import { useQuery } from '@tanstack/react-query'
import { conversationAPI } from '../api/converstion'


export default function ChatPage() {
  const { convId: routeConvId } = useParams<{ convId?: string }>()
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Session Store
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const createSession = useSessionStore((s) => s.createSession)
  const switchSession = useSessionStore((s) => s.switchSession)
  const addMessage = useSessionStore((s) => s.addMessage)
  const appendToLastMessage = useSessionStore((s) => s.appendToLastMessage)
  const getCurrentSession = useSessionStore((s) => s.getCurrentSession)
  const { data: remoteMessages } = useQuery({
    queryKey: ['messages', currentSessionId],
    queryFn: () => conversationAPI.getMessages(currentSessionId!),
    enabled: !!currentSessionId,
  })
  const session = getCurrentSession()
  const messages = session?.messages || []

  // 初始化：URL 有 convId 则切换，没有则新建
  useEffect(() => {
    if (routeConvId) {
      switchSession(routeConvId)
    } else if (!currentSessionId) {
      const id = createSession('llm')
      navigate(`/chat/${id}`, { replace: true })
    }
  }, [])
  useEffect(() => {
    if (remoteMessages?.length && session?.messages.length === 0) {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId
            ? {
              ...s,
              messages: remoteMessages.map((m: any) => ({
                role: m.role,
                content: m.content,
                date: m.created_at,
              })),
            }
            : s
        ),
      }))
    }
  }, [remoteMessages])


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSubmit = async () => {
    const prompt = input.trim()
    if (!prompt || isStreaming || !currentSessionId) return

    // 用户消息
    addMessage({ role: 'user', content: prompt })
    // AI 占位消息
    addMessage({ role: 'assistant', content: '' })
    setInput('')
    setIsStreaming(true)

    const historyMessages = session?.messages
      .filter((m) => m.role !== 'assistant' || m.content)
      .map((m) => ({ role: m.role, content: m.content })) || []

    await streamChat(
      { prompt, chat_history: historyMessages },
      (token) => appendToLastMessage(token),
      () => {
        // 流式结束，存 AI 完整回复
        const session = useSessionStore.getState()
          .sessions.find((s) => s.id === currentSessionId)
        const lastMsg = session?.messages.at(-1)
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content) {
          conversationAPI.addMessage(currentSessionId!, 'assistant', lastMsg.content)
            .catch(console.error)
        }
        setIsStreaming(false)
      },
      (error) => {
        appendToLastMessage(`\n\n错误: ${error.message}`)
        setIsStreaming(false)
      },
    )
  }


  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-2xl mb-2">✨</p>
              <p>开始一段对话吧</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-md'
                  : 'bg-white border border-gray-200 text-gray-900 rounded-bl-md shadow-sm'
                  }`}
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="flex justify-between items-start">
                    <div className="prose prose-sm max-w-none prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                      <Markdown content={msg.content} />
                      {isStreaming && i === messages.length - 1 && (
                        <span className="inline-block w-2 h-4 bg-indigo-600 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                    {!isStreaming && msg.content && (
                      <SpeakButton text={msg.content} />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入框 */}
      <div className="border-t border-gray-200 bg-white flex-shrink-0">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex gap-3 items-center">
            <VoiceInput
              onResult={(text) => setInput((prev) => prev + text)}
              disabled={isStreaming}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         disabled:bg-gray-100 disabled:cursor-not-allowed overflow-hidden"
            />
            <button
              onClick={handleSubmit}
              disabled={isStreaming || !input.trim()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl
                         hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors flex-shrink-0"
            >
              {isStreaming ? '思考中...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}