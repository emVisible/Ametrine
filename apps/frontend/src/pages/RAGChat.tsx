// src/pages/RAGChat.tsx
import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { streamRAG } from "../api/chat";
import { collectionAPI } from "../api/rag";
import Markdown from "../components/Markdown";
import VoiceInput from "../components/VoiceInput";
import { apiClient } from "../api/client";

interface Message {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}
interface Reference {
  title: string;
  uploader: string;
  source: string;
  created_at: string;
  relevance_score?: number;
  chunk_id?: number;
}
interface Database {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
}
interface Collection {
  id: number;
  name: string;
  description: string;
}

export default function RAGChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [references, setReferences] = useState<Reference[]>([]);
  const [selectedDbId, setSelectedDbId] = useState<number | null>(null);
  const [selectedColId, setSelectedColId] = useState<number | null>(null);
  const [enableRerank, setEnableRerank] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: databases, isLoading: dbLoading } = useQuery({
    queryKey: ["my-databases"],
    queryFn: () => apiClient<any[]>("/relation/database/mine"),
  });
  const { data: collections, isLoading: colLoading } = useQuery({
    queryKey: ["pg-collections", selectedDbId],
    queryFn: () => collectionAPI.getByDatabase(selectedDbId!),
    enabled: !!selectedDbId,
  });

  useEffect(() => {
    setSelectedColId(null);
  }, [selectedDbId]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const selectedDb = databases?.find((db: Database) => db.id === selectedDbId);
  const selectedCol = collections?.find(
    (col: Collection) => col.id === selectedColId,
  );
  const canSend = input.trim() && !isStreaming && selectedDbId && selectedColId;

  const handleSubmit = async () => {
    const prompt = input.trim();
    if (!canSend || !selectedDb || !selectedCol) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt },
      { role: "assistant", content: "", isStreaming: true },
    ]);
    setInput("");
    setIsStreaming(true);
    setReferences([]);
    const chatHistory = messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }));

    await streamRAG(
      {
        prompt,
        chat_history: chatHistory,
        database_name: selectedDb.name,
        collection_name: selectedCol.name,
      },
      (token) =>
        setMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1 && msg.role === "assistant"
              ? { ...msg, content: msg.content + token }
              : msg,
          ),
        ),
      (refs) => {
        setMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1 && msg.role === "assistant"
              ? { ...msg, isStreaming: false }
              : msg,
          ),
        );
        if (refs && Array.isArray(refs) && refs.length > 0)
          setReferences(refs as Reference[]);
        setIsStreaming(false);
      },
      (error) => {
        setMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1 && msg.role === "assistant"
              ? {
                  ...msg,
                  content: `错误: ${error.message}`,
                  isStreaming: false,
                }
              : msg,
          ),
        );
        setIsStreaming(false);
      },
    );
  };

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 flex flex-col">
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              知识库
            </span>
            <div className="relative">
              <select
                value={selectedDbId ?? ""}
                onChange={(e) =>
                  setSelectedDbId(
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
                disabled={dbLoading}
                className="appearance-none bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-3 pr-8 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
              >
                <option value="">选择知识库</option>
                {databases?.map((db) => (
                  <option key={db.id} value={db.id}>
                    {db.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              集合
            </span>
            <div className="relative">
              <select
                value={selectedColId ?? ""}
                onChange={(e) =>
                  setSelectedColId(
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
                disabled={!selectedDbId || colLoading}
                className="appearance-none bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-3 pr-8 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px]"
              >
                <option value="">选择集合</option>
                {collections?.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedDb && selectedCol && (
            <>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <div className="flex items-center gap-1.5 text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-2.5 py-1 rounded-full">
                <span className="font-medium">{selectedDb.name}</span>
                <span className="text-indigo-400">/</span>
                <span className="font-medium">{selectedCol.name}</span>
              </div>
            </>
          )}
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Rerank
            </span>
            <div className="relative">
              <input
                type="checkbox"
                checked={enableRerank}
                onChange={(e) => setEnableRerank(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600" />
            </div>
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 dark:text-gray-500 mt-6">
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-base font-medium text-gray-500 dark:text-gray-400 mb-1">
                基于知识库的 RAG 检索对话
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                {!selectedDbId
                  ? "请先选择一个知识库"
                  : !selectedColId
                    ? "请再选择一个集合"
                    : "在下方输入问题开始检索"}
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "bg-indigo-600 dark:bg-indigo-500 text-white rounded-br-md" : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-md shadow-sm"}`}
              >
                {msg.role === "user" ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                    <Markdown content={msg.content} />
                    {msg.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-indigo-600 dark:bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {references.length > 0 && (
            <div className="max-w-[85%] bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  📚 引用来源
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
                    (已通过 Rerank 重排序)
                  </span>
                </h3>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {references.length} 条结果
                </span>
              </div>
              <div className="space-y-2">
                {references.map((ref, i) => {
                  const score = ref.relevance_score ?? 0;
                  const isHigh = score >= 0.7,
                    isMid = score >= 0.4 && score < 0.7;
                  return (
                    <div
                      key={i}
                      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 p-3 hover:border-gray-200 dark:hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="w-5 h-5 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {ref.title}
                            </p>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              <span>{ref.uploader}</span>
                              <span>·</span>
                              <span>{ref.created_at?.slice(0, 10)}</span>
                              {ref.chunk_id && (
                                <>
                                  <span>·</span>
                                  <span className="text-gray-400 dark:text-gray-500">
                                    分块 #{ref.chunk_id}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {score > 0 && (
                          <div className="flex-shrink-0">
                            <div
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isHigh ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : isMid ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"}`}
                            >
                              {(score * 100).toFixed(0)}%
                            </div>
                          </div>
                        )}
                      </div>
                      {score > 0 && (
                        <div className="mt-2 w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1">
                          <div
                            className={`h-1 rounded-full ${isHigh ? "bg-green-500" : isMid ? "bg-yellow-500" : "bg-red-400"}`}
                            style={{ width: `${score * 100}%` }}
                          />
                        </div>
                      )}
                      {score > 0 && score < 0.4 && (
                        <p className="mt-1.5 text-[11px] text-red-500 dark:text-red-400">
                          ⚠️ 该来源相关性较低，内容可能不准确
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
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
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                !selectedDbId
                  ? "请先在上方选择知识库"
                  : !selectedColId
                    ? "请先在上方选择集合"
                    : "输入问题检索知识库，Enter 发送，Shift+Enter 换行"
              }
              rows={1}
              disabled={isStreaming || !selectedDbId || !selectedColId}
              className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed overflow-hidden"
            />
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className="px-5 py-2 bg-indigo-600 dark:bg-indigo-500 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0 flex items-center gap-1.5"
            >
              {isStreaming ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  检索中
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  发送
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
