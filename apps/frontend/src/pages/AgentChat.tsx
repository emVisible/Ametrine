// src/pages/AgentChat.tsx
import { useState, useRef, useEffect } from 'react'
import { streamAgent } from '../api/agent'
import Markdown from '../components/Markdown'
import { useNavigate } from 'react-router'
import VoiceInput from '../components/VoiceInput'

interface ToolAction {
  tool: string
  input: string
  status: 'running' | 'done'
  output?: string
}

interface AgentMessage {
  type: 'user' | 'agent' | 'tool' | 'thought'
  content: string
  toolActions?: ToolAction[]
}

export default function AgentChatPage() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolAction[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentToolCalls])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSubmit = async () => {
    const query = input.trim()
    if (!query || isStreaming) return

    setMessages((prev) => [...prev, { type: 'user', content: query }])
    setInput('')
    setIsStreaming(true)
    setCurrentToolCalls([])

    // 创建一个占位的 agent 消息
    setMessages((prev) => [...prev, { type: 'agent', content: '' }])

    await streamAgent(
      query,
      // onText — 追加文本到最后一个 agent 消息
      (text) => {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.type === 'agent') {
            last.content += text
          }
          return updated
        })
      },
      // onToolCall — 记录工具调用
      (tool, toolInput) => {
        setCurrentToolCalls((prev) => [
          ...prev,
          { tool, input: toolInput, status: 'done' },
        ])
      },
      // onThought — 显示 Agent 思考
      (thought) => {
        setMessages((prev) => [
          ...prev,
          { type: 'thought', content: thought },
        ])
      },
      // onComplete
      () => {
        // 把工具调用合并到消息里
        if (currentToolCalls.length > 0) {
          setMessages((prev) => [
            ...prev,
            {
              type: 'tool',
              content: '工具调用完成',
              toolActions: [...currentToolCalls],
            },
          ])
        }
        setIsStreaming(false)
        setCurrentToolCalls([])
      },
      // onError
      (error) => {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.type === 'agent') {
            last.content = `错误: ${error.message}`
          }
          return updated
        })
        setIsStreaming(false)
      },
    )
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* 顶部 */}
      <nav className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">
            🤖 Agent Chat
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/chat')}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              LLM Chat
            </button>
            <button
              onClick={() => navigate('/rag')}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              RAG Chat
            </button>
          </div>
        </div>
      </nav>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-3xl mb-3">🤖</p>
              <p className="text-base font-medium text-gray-500 mb-1">
                Agent 智能助手
              </p>
              <p className="text-sm text-gray-400">
                我可以搜索网页、查阅维基百科、执行 Shell 命令
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.type === 'tool' && msg.toolActions) {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">工具调用</span>
                    </div>
                    <div className="space-y-2">
                      {msg.toolActions.map((action, j) => (
                        <div key={j} className="bg-white border border-gray-100 rounded-lg p-3 text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-indigo-700">{action.tool}</span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${action.status === 'done'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-yellow-100 text-yellow-700'
                              }`}>
                              {action.status === 'done' ? '完成' : '运行中'}
                            </span>
                          </div>
                          <p className="text-gray-600 font-mono break-all">{action.input}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            }

            if (msg.type === 'thought') {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 text-xs text-yellow-800 italic">
                    💭 {msg.content}
                  </div>
                </div>
              )
            }

            if (msg.type === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-3 text-sm">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              )
            }

            if (msg.type === 'agent') {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] bg-white border border-gray-200 rounded-2xl rounded-bl-md shadow-sm px-4 py-3 text-sm">
                    <div className="prose prose-sm max-w-none">
                      <Markdown content={msg.content} />
                      {isStreaming && i === messages.length - 1 && (
                        <span className="inline-block w-2 h-4 bg-indigo-600 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                  </div>
                </div>
              )
            }

            return null
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 输入框 */}
      <div className="border-t border-gray-200 bg-white shrink-0">
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
              placeholder="输入任务，Agent 会自主调用工具完成..."
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         disabled:bg-gray-100 disabled:cursor-not-allowed overflow-hidden"
            />
            <button
              onClick={handleSubmit}
              disabled={isStreaming || !input.trim()}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl
                         hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors flex-shrink-0 flex items-center gap-1.5"
            >
              {isStreaming ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  执行中
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  发送
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}