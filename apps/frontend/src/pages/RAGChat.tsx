// src/pages/RAGChat.tsx
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { streamRAG } from '../api/chat'
import { databaseAPI, collectionAPI } from '../api/rag'
import Markdown from '../components/Markdown'
import useAuthStore from '../stores/useAuthStore'
import { useNavigate } from 'react-router'
import VoiceInput from '../components/VoiceInput'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

interface Reference {
  title: string
  uploader: string
  source: string
  created_at: string
  relevance_score?: number
  chunk_id?: number
}

interface Database {
  id: number
  name: string
  description: string
  is_active: boolean
}

interface Collection {
  id: number
  name: string
  description: string
}

export default function RAGChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [references, setReferences] = useState<Reference[]>([])
  const [selectedDbId, setSelectedDbId] = useState<number | null>(null)
  const [selectedColId, setSelectedColId] = useState<number | null>(null)
  const [enableRerank, setEnableRerank] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  // 获取知识库列表
  const { data: databases, isLoading: dbLoading } = useQuery({
    queryKey: ['pg-databases'],
    queryFn: databaseAPI.getAll,
  })

  // 获取集合列表
  const { data: collections, isLoading: colLoading } = useQuery({
    queryKey: ['pg-collections', selectedDbId],
    queryFn: () => collectionAPI.getByDatabase(selectedDbId!),
    enabled: !!selectedDbId,
  })

  // 选中知识库后自动清空集合选择
  useEffect(() => {
    setSelectedColId(null)
  }, [selectedDbId])

  // 自动滚底
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

  const selectedDb = databases?.find((db: Database) => db.id === selectedDbId)
  const selectedCol = collections?.find((col: Collection) => col.id === selectedColId)

  const canSend = input.trim() && !isStreaming && selectedDbId && selectedColId

  const handleSubmit = async () => {
    const prompt = input.trim()
    if (!canSend || !selectedDb || !selectedCol) return

    const userMessage: Message = { role: 'user', content: prompt }
    const assistantMessage: Message = { role: 'assistant', content: '', isStreaming: true }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInput('')
    setIsStreaming(true)
    setReferences([])

    const chatHistory = messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }))

    await streamRAG(
      { prompt, chat_history: chatHistory, database_name: selectedDb.name, collection_name: selectedCol.name },
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
      (refs) => {
        // 用函数式更新确保拿到最新状态
        setMessages((prev) =>
          prev.map((msg, idx) => {
            if (idx === prev.length - 1 && msg.role === 'assistant') {
              return { ...msg, isStreaming: false }
            }
            return msg
          })
        )
        if (refs && Array.isArray(refs) && refs.length > 0) {
          setReferences(refs as Reference[])
        }
        setIsStreaming(false)
      },
      (error) => {
        setMessages((prev) => {
          const updated = prev.map((msg, idx) => {
            if (idx === prev.length - 1 && msg.role === 'assistant') {
              return { ...msg, content: `错误: ${error.message}`, isStreaming: false }
            }
            return msg
          })
          return updated
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
      <nav className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">RAG Chat</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/admin/vector')}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              管理知识库
            </button>
            <button
              onClick={() => navigate('/chat')}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              LLM Chat
            </button>
            <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-800">
              退出
            </button>
          </div>
        </div>
      </nav>

      {/* 知识库选择栏 */}
      <div className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-3">
          {/* 知识库下拉 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 whitespace-nowrap">知识库</span>
            <div className="relative">
              <select
                value={selectedDbId ?? ''}
                onChange={(e) => setSelectedDbId(e.target.value ? Number(e.target.value) : null)}
                disabled={dbLoading}
                className="appearance-none bg-gray-50 border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
              >
                <option value="">选择知识库</option>
                {databases?.map((db: Database) => (
                  <option key={db.id} value={db.id}>
                    {db.name}
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {dbLoading && (
              <div className="w-4 h-4 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />
            )}
          </div>

          {/* 分隔符 */}
          <span className="text-gray-300">|</span>

          {/* 集合下拉 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 whitespace-nowrap">集合</span>
            <div className="relative">
              <select
                value={selectedColId ?? ''}
                onChange={(e) => setSelectedColId(e.target.value ? Number(e.target.value) : null)}
                disabled={!selectedDbId || colLoading}
                className="appearance-none bg-gray-50 border border-gray-300 rounded-lg pl-3 pr-8 py-1.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                           disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
              >
                <option value="">选择集合</option>
                {collections?.map((col: Collection) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {colLoading && (
              <div className="w-4 h-4 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />
            )}
          </div>

          {/* 当前选中信息 */}
          {selectedDb && selectedCol && (
            <>
              <span className="text-gray-300">|</span>
              <div className="flex items-center gap-1.5 text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium">{selectedDb.name}</span>
                <span className="text-indigo-400">/</span>
                <span className="font-medium">{selectedCol.name}</span>
              </div>
            </>
          )}

          {/* 分隔符 */}
          <span className="text-gray-300">|</span>

          {/* Rerank 开关 */}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-xs text-gray-500">Rerank</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={enableRerank}
                onChange={(e) => setEnableRerank(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600" />
            </div>
          </label>
        </div>
      </div>
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20">
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-base font-medium text-gray-500 mb-1">基于知识库的 RAG 检索对话</p>
              <p className="text-sm text-gray-400">
                {!selectedDbId
                  ? '请先选择一个知识库'
                  : !selectedColId
                    ? '请再选择一个集合'
                    : '在下方输入问题开始检索'}
              </p>
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
                  <div className="prose prose-sm max-w-none prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                    <Markdown content={msg.content} />
                    {msg.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-indigo-600 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* 引用来源 */}
          {references.length > 0 && (
            <div className="max-w-[85%] bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  引用来源
                  <span className="text-xs text-gray-400 font-normal">
                    (已通过 Rerank 重排序)
                  </span>
                </h3>
                <span className="text-xs text-gray-400">{references.length} 条结果</span>
              </div>

              <div className="space-y-2">
                {references.map((ref, i) => {
                  const score = ref.relevance_score ?? 0
                  const isHighConfidence = score >= 0.7
                  const isMediumConfidence = score >= 0.4 && score < 0.7

                  return (
                    <div
                      key={i}
                      className="bg-white rounded-lg border border-gray-100 p-3 hover:border-gray-200 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        {/* 左侧：序号 + 标题 */}
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="w-5 h-5 rounded bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{ref.title}</p>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                              <span>{ref.uploader}</span>
                              <span>·</span>
                              <span>{ref.created_at?.slice(0, 10)}</span>
                              {ref.chunk_id && (
                                <>
                                  <span>·</span>
                                  <span className="text-gray-400">分块 #{ref.chunk_id}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 右侧：相关性评分 */}
                        {score > 0 && (
                          <div className="flex-shrink-0">
                            <div
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isHighConfidence
                                ? 'bg-green-100 text-green-700'
                                : isMediumConfidence
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-red-100 text-red-700'
                                }`}
                              title={`相关性: ${(score * 100).toFixed(1)}%`}
                            >
                              {isHighConfidence && (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              )}
                              {isMediumConfidence && (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                              )}
                              {(score * 100).toFixed(0)}%
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 置信度进度条 */}
                      {score > 0 && (
                        <div className="mt-2 w-full bg-gray-100 rounded-full h-1">
                          <div
                            className={`h-1 rounded-full transition-all ${isHighConfidence
                              ? 'bg-green-500'
                              : isMediumConfidence
                                ? 'bg-yellow-500'
                                : 'bg-red-400'
                              }`}
                            style={{ width: `${score * 100}%` }}
                          />
                        </div>
                      )}

                      {/* 低置信度警告 */}
                      {score > 0 && score < 0.4 && (
                        <p className="mt-1.5 text-[11px] text-red-500 flex items-center gap-1">
                          ⚠️ 该来源相关性较低，内容可能不准确
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}


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
              placeholder={
                !selectedDbId
                  ? '请先在上方选择知识库'
                  : !selectedColId
                    ? '请先在上方选择集合'
                    : '输入问题检索知识库，Enter 发送，Shift+Enter 换行'
              }
              rows={1}
              disabled={isStreaming || !selectedDbId || !selectedColId}
              className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         disablaed:bg-gray-100 disabled:cursor-not-allowed placeholder:text-gray-400 overflow-hidden"
            />
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl
                         hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors flex-shrink-0 flex items-center gap-1.5"
            >
              {isStreaming ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  检索中
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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