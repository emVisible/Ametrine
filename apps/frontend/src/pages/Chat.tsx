// src/pages/Chat.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { streamChat } from "../api/chat";
import Markdown from "../components/Markdown";
import VoiceInput from "../components/VoiceInput";
import useSessionStore, { type HistoryMessage } from "../stores/sessionStore";
import { useQuery } from "@tanstack/react-query";
import { conversationAPI } from "../api/converstion";

export default function ChatPage() {
  const { convId: routeConvId } = useParams<{ convId?: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const switchSession = useSessionStore((s) => s.switchSession);

  const { data: remoteMessages } = useQuery({
    queryKey: ["messages", currentSessionId],
    queryFn: () => conversationAPI.getMessages(currentSessionId!),
    enabled: !!currentSessionId,
  });

  // 从 store 同步 messages 到本地 state（仅在会话切换时）
  const storeMessages = useSessionStore((s) => {
    const session = s.sessions.find((x) => x.id === s.currentSessionId);
    return session?.messages;
  });

  useEffect(() => {
    if (routeConvId) {
      switchSession(routeConvId);
    } else if (!currentSessionId) {
      createSession("llm").then((id) =>
        navigate(`/chat/${id}`, { replace: true }),
      );
    }
  }, []);

  // 会话切换时加载消息
  useEffect(() => {
    if (storeMessages) {
      setMessages(storeMessages);
    }
  }, [currentSessionId]);

  // 远程消息恢复
  useEffect(() => {
    if (remoteMessages?.length && messages.length === 0) {
      const restored = remoteMessages.map((m: any) => ({
        role: m.role,
        content: m.content,
        date: m.created_at,
      }));
      setMessages(restored);
      // 同步回 store
      if (currentSessionId) {
        useSessionStore.setState((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === currentSessionId ? { ...s, messages: restored } : s,
          ),
        }));
      }
    }
  }, [remoteMessages, currentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // 同步 messages 到 store（每次变化时）
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === currentSessionId
            ? { ...s, messages, updatedAt: new Date().toISOString() }
            : s,
        ),
      }));
    }
  }, [messages, currentSessionId]);

  const handleSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming || !currentSessionId) return;

    const userMsg: HistoryMessage = {
      role: "user",
      content: prompt,
      date: new Date().toLocaleTimeString("zh-CN"),
    };
    const assistantMsg: HistoryMessage = { role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsStreaming(true);

    const historyMessages = messages
      .filter((m) => m.role !== "assistant" || m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    // 存用户消息到后端
    conversationAPI
      .addMessage(currentSessionId, "user", prompt)
      .catch(console.error);

    await streamChat(
      { prompt, chat_history: historyMessages },
      (token) => {
        setMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1 && msg.role === "assistant"
              ? { ...msg, content: msg.content + token }
              : msg,
          ),
        );
      },
      () => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.content) {
            conversationAPI
              .addMessage(currentSessionId, "assistant", last.content)
              .catch(console.error);
          }
          return prev;
        });
        setIsStreaming(false);
      },
      (error) => {
        setMessages((prev) =>
          prev.map((msg, idx) =>
            idx === prev.length - 1 && msg.role === "assistant"
              ? { ...msg, content: `错误: ${error.message}` }
              : msg,
          ),
        );
        setIsStreaming(false);
      },
    );
  }, [input, isStreaming, currentSessionId, messages]);

  return (
    <div className="h-full bg-gray-50 dark:bg-gray-950 flex flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 dark:text-gray-500 mt-20">
              <p className="text-2xl mb-2">✨</p>
              <p>开始一段对话吧</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 dark:bg-indigo-500 text-white rounded-br-md"
                    : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-md shadow-sm"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                    <Markdown content={msg.content} />
                    {isStreaming && i === messages.length - 1 && (
                      <span className="inline-block w-2 h-4 bg-indigo-600 dark:bg-indigo-400 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
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
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed overflow-hidden"
            />
            <button
              onClick={handleSubmit}
              disabled={isStreaming || !input.trim()}
              className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white text-sm font-medium rounded-xl
                         hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {isStreaming ? "思考中..." : "发送"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
