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
import { useI18n } from "../i18n/context";
import { useSessionMessages } from "../hooks/useSessionMessages";
import useSessionStore, { type HistoryMessage } from "../stores/sessionStore";
import {
  beginStream,
  endStream,
  failStream,
  stopStream,
} from "../stores/streamStore";

interface RemoteMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export default function ChatPage() {
  const { t } = useI18n();
  const [input, setInput] = useState("");

  const {
    messages,
    sessionId,
    streaming,
    error,
    ensureSession,
    setMessages,
    clearError,
  } = useSessionMessages<HistoryMessage>("llm");

  const { data: remoteMessages } = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => conversationAPI.getMessages(sessionId!),
    enabled: !!sessionId,
  });

  // 本地 store 丢了（换设备或清缓存）时从后端回灌。按会话 id 记录「回灌过哪一条」，
  // 否则切到第二条会话时这个 ref 仍然为 true，新会话永远拿不到远端历史。
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      !sessionId ||
      restoredFor.current === sessionId ||
      messages.length > 0 ||
      !remoteMessages?.length
    )
      return;
    restoredFor.current = sessionId;
    setMessages(
      remoteMessages.map((m: RemoteMessage) => ({
        role: m.role,
        content: m.content,
        date: m.created_at,
      })),
    );
  }, [remoteMessages, messages.length, sessionId, setMessages]);

  const stop = useCallback(() => {
    if (!sessionId) return;
    useSessionStore.getState().discardEmptyTurn(sessionId);
    stopStream(sessionId);
  }, [sessionId]);

  const handleSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt) return;

    // 会话在按下发送这一刻才创建：以前裸 /chat 一进来就写库，
    // 于是「看一眼对话页」会留下一条永远删不掉的空 Conversation。
    const id = await ensureSession();
    if (!id) return;

    // 这一轮流式属于会话 id，而不是这个组件实例：控制器放进会话级注册表，
    // 切会话导致本组件卸载时不会 abort，回来还能看见它在继续生成。
    const controller = beginStream(id);
    if (!controller) return;

    const history = useSessionStore.getState().beginTurn(id, prompt);
    setInput("");
    clearError();

    conversationAPI.addMessage(id, "user", prompt).catch(() => {});

    // 故意不 await：await 会把这轮流的生命周期绑回组件的渲染时机上，
    // 卸载时的清理就会打断它。
    void streamChat(
      { prompt, chat_history: history },
      (token) => useSessionStore.getState().appendToken(id, token),
      () => {
        const last = useSessionStore
          .getState()
          .sessions.find((s) => s.id === id)
          ?.messages.at(-1);
        if (last?.role === "assistant" && last.content) {
          conversationAPI.addMessage(id, "assistant", last.content).catch(() => {});
        }
        endStream(id);
      },
      (err) => {
        useSessionStore.getState().discardEmptyTurn(id);
        failStream(id, err.message);
      },
      controller.signal,
    );
  }, [input, ensureSession, clearError]);

  const view: ChatMessage[] = messages.map((m, i) => ({
    role: m.role,
    content: m.content,
    streaming:
      m.role === "assistant" && streaming && i === messages.length - 1,
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
            title={t("chat.emptyChatTitle")}
            description={t("chat.emptyChatDesc")}
            aside={
              <p className="text-[11px] text-ink-subtle">{t("chat.enterHint")}</p>
            }
          />
        }
      />

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        busy={streaming}
        placeholder={t("chat.placeholder")}
        right={
          <VoiceInput
            onResult={(text) =>
              setInput((prev) => (prev ? `${prev} ${text}` : text))
            }
            disabled={streaming}
          />
        }
      />
    </div>
  );
}
