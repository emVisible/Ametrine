// src/pages/Chat.tsx
import { useState, useRef, useEffect } from 'react'
import { streamChat } from '../api/chat'
import Markdown from '../components/Markdown'
import useAuthStore from '../stores/useAuthStore'
import { useNavigate } from 'react-router'
import VoiceInput from '../components/VoiceInput'
import SpeakButton from '../components/SpeakButton'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  // 自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 自动调整输入框高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSubmit = async () => {
    const prompt = input.trim()
    if (!prompt || isStreaming) return

    const userMessage: Message = { role: 'user', content: prompt }
    const assistantMessage: Message = { role: 'assistant', content: '', isStreaming: true }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)

    const chatHistory = messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }))

    await streamChat(
      { prompt, chat_history: chatHistory },
      (token) => {
        setMessages((prev) => {
          const updated = prev.map((msg, idx) => {
            if (idx === prev.length - 1 && msg.role === 'assistant') {
              return { ...msg, content: msg.content + token }
            }
            return msg
          })
          return updated
        })
      },
      () => {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            last.isStreaming = false
          }
          return [...updated]
        })
        setIsStreaming(false)
      },
      (error) => {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            last.content = `错误: ${error.message}`
            last.isStreaming = false
          }
          return [...updated]
        })
        setIsStreaming(false)
      },
    )
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* 顶部导航 */}
      < nav className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0" >
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">LLM Chat</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              仪表盘
            </button>
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-800"
            >
              退出
            </button>
          </div>
        </div>
      </ nav>

      {/* 消息列表 */}
      < div className="flex-1 overflow-y-auto px-4 py-6" >
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
                      {msg.isStreaming && (
                        <span className="inline-block w-2 h-4 bg-indigo-600 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                    {!msg.isStreaming && msg.content && (
                      <SpeakButton text={msg.content} />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ div>

      {/* 输入框 */}
      < div className="border-t border-gray-200 bg-white flex-shrink-0" >
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
      </ div>
    </div >
  )
}