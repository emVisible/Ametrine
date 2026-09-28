// src/pages/Chat.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { conversationAPI } from "../api/converstion";
import { streamChat } from "../api/chat";
import {
  Composer,
  EmptyState,
  ErrorNotice,
  MessageList,
  type ChatMessage,
} from "../components/chat";
import VoiceInput from "../components/VoiceInput";
import { ChatIcon } from "../components/icons";
import { useSessionMessages } from "../hooks/useSessionMessages";
import type { HistoryMessage } from "../stores/sessionStore";

interface RemoteMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    messages,
    setMessages,
    currentSessionId,
    beginTurn,
    appendToken,
    discardEmptyTurn,
  } = useSessionMessages<HistoryMessage>("llm");

  const { data: remoteMessages } = useQuery({
    queryKey: ["messages", currentSessionId],
    queryFn: () => conversationAPI.getMessages(currentSessionId!),
    enabled: !!currentSessionId,
  });

  // 本地 store 丢了（换设备或清缓存）时从后端回灌
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || messages.length > 0 || !remoteMessages?.length)
      return;
    restoredRef.current = true;
    setMessages(
      remoteMessages.map((m: RemoteMessage) => ({
        role: m.role,
        content: m.content,
        date: m.created_at,
      })),
    );
  }, [remoteMessages, messages.length, setMessages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    discardEmptyTurn();
  }, [discardEmptyTurn]);

  const handleSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming || !currentSessionId) return;

    const history = beginTurn(prompt);
    setInput("");
    setIsStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    conversationAPI.addMessage(currentSessionId, "user", prompt).catch(() => {});

    await streamChat(
      { prompt, chat_history: history },
      appendToken,
      () => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content) {
            conversationAPI
              .addMessage(currentSessionId, "assistant", last.content)
              .catch(() => {});
          }
          return prev;
        });
        setIsStreaming(false);
        abortRef.current = null;
      },
      (err) => {
        discardEmptyTurn();
        setError(err.message);
        setIsStreaming(false);
        abortRef.current = null;
      },
      controller.signal,
    );
  }, [
    input,
    isStreaming,
    currentSessionId,
    beginTurn,
    appendToken,
    discardEmptyTurn,
    setMessages,
  ]);

  const view: ChatMessage[] = messages.map((m, i) => ({
    role: m.role,
    content: m.content,
    streaming:
      m.role === "assistant" && isStreaming && i === messages.length - 1,
  }));

  return (
    <div className="flex h-full flex-col bg-canvas">
      <MessageList
        messages={view}
        banner={
          error ? (
            <ErrorNotice message={error} onRetry={handleSubmit} />
          ) : undefined
        }
        empty={
          <EmptyState
            icon={ChatIcon}
            title="开始新的对话"
            description="回答仅来自模型本身，不检索知识库。需要基于文档作答请切换到检索模式。"
          />
        }
      />

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        busy={isStreaming}
        placeholder="输入消息…"
        hint="Enter 发送 · Shift + Enter 换行"
        leading={
          <VoiceInput
            onResult={(text) =>
              setInput((prev) => (prev ? `${prev} ${text}` : text))
            }
            disabled={isStreaming}
          />
        }
      />
    </div>
  );
}
