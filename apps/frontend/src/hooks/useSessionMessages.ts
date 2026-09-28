// src/hooks/useSessionMessages.ts
// Chat 与 RAGChat 共用的会话绑定。
//
// 会话是**首次发送时**才创建的：以前裸 /chat、/rag 一进来就 createSession，
// 光是访问路由就会在库里留下一条没人写过的 Conversation（删掉账号也删不掉）。
// 现在裸路由保持 currentSessionId = null，发送前才补建并把 URL 换过去。
//
// 代价是这套 hook 不能再依赖「路由变化整棵子树重挂载」来重置 messages：
// /chat → /chat/<id> 属于同一路由，AppLayout 的舞台按路由根分段，不会重建页面，
// 所以会话之间的切换由下面的 convId 同步 effect 显式负责。
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import useSessionStore, {
  type HistoryMessage,
  type Session,
} from "../stores/sessionStore";

const MODE_ROUTE: Record<Session["mode"], string> = {
  llm: "chat",
  rag: "rag",
  agent: "chat",
};

export function useSessionMessages<T extends HistoryMessage = HistoryMessage>(
  mode: Session["mode"],
) {
  const { convId } = useParams<{ convId?: string }>();
  const navigate = useNavigate();

  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const switchSession = useSessionStore((s) => s.switchSession);

  const [messages, setMessages] = useState<T[]>(() => {
    const session = useSessionStore.getState().sessions.find(
      (s) => s.id === (convId ?? useSessionStore.getState().currentSessionId),
    );
    return (session?.messages ?? []) as T[];
  });

  // URL 与 store 必须双向自洽。
  // convId 可能指向一个已被删除（或属于另一种模式）的会话 —— 无条件
  // switchSession(convId) 会把这种幽灵 ID 重新写回 store，删除就看起来没生效。
  useEffect(() => {
    const state = useSessionStore.getState();
    const target = convId
      ? state.sessions.find((s) => s.id === convId && s.mode === mode)
      : null;

    if (target) {
      if (state.currentSessionId !== target.id) switchSession(target.id);
      return;
    }

    if (convId) {
      // 幽灵 ID：清掉当前指向并把地址退回裸路由，等着首次发送去建新会话
      switchSession(null);
      navigate(`/${MODE_ROUTE[mode]}`, { replace: true });
      return;
    }

    const reusable = state.sessions.find((s) => s.mode === mode);
    if (reusable && state.currentSessionId !== reusable.id) {
      switchSession(reusable.id);
      navigate(`/${MODE_ROUTE[mode]}/${reusable.id}`, { replace: true });
    }
    // 没有任何同模式会话时什么都不做：裸路由 + currentSessionId 为空是合法状态，
    // 会话等 handleSubmit 里 ensureSession() 去建。
  }, [convId, currentSessionId, mode, navigate, switchSession]);

  /**
   * 拿到一个可用的会话 ID：有就用，没有才建。
   * 返回 null 只可能是 createSession 抛错（store 内部已降级为本地 UUID，一般不会）。
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    const state = useSessionStore.getState();
    const existing = convId ?? state.currentSessionId;
    if (existing && state.sessions.some((s) => s.id === existing)) {
      if (state.currentSessionId !== existing) switchSession(existing);
      return existing;
    }
    const id = await state.createSession(mode);
    navigate(`/${MODE_ROUTE[mode]}/${id}`, { replace: true });
    return id;
  }, [convId, mode, navigate, switchSession]);

  // 同一路由内切会话不再重挂载，所以 messages 要显式跟着 convId 走，
  // 否则会把上一个会话的消息留在屏幕上（旧行为靠 remount 掩盖）。
  const lastSyncedRef = useRef<string | null>(convId ?? null);
  useEffect(() => {
    const key = currentSessionId ?? convId ?? null;
    if (lastSyncedRef.current === key) return;
    lastSyncedRef.current = key;
    const session = useSessionStore
      .getState()
      .sessions.find((s) => s.id === key);
    setMessages((session?.messages ?? []) as unknown as T[]);
  }, [currentSessionId, convId]);

  // 写回外部 store：这是 effect 的正当用途（同步到 React 之外的系统）
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === currentSessionId
          ? {
              ...s,
              messages: messages as HistoryMessage[],
              updatedAt: new Date().toISOString(),
            }
          : s,
      ),
    }));
  }, [messages, currentSessionId]);

  // 两个对话页都直接写 store、绕过了 sessionStore.addMessage，
  // 于是自动命名逻辑从未生效，侧栏里全是「新对话」。这里补回唯一一处。
  useEffect(() => {
    if (!currentSessionId) return;
    const first = messages.find((m) => m.role === "user");
    if (!first?.content) return;
    const session = useSessionStore
      .getState()
      .sessions.find((s) => s.id === currentSessionId);
    if (session?.title === "新对话") {
      useSessionStore.getState().renameSession(currentSessionId, first.content.slice(0, 40));
    }
  }, [messages, currentSessionId]);

  /** 追加一轮「用户提问 + 空的助手气泡」，返回本次的历史快照。 */
  const beginTurn = useCallback(
    (prompt: string) => {
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [
        ...prev,
        { role: "user", content: prompt, date: new Date().toISOString() },
        { role: "assistant", content: "" },
      ] as unknown as T[]);
      return history;
    },
    [messages],
  );

  /** 把 token 追加到最后一条助手消息上。 */
  const appendToken = useCallback((token: string) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1 && m.role === "assistant"
          ? { ...m, content: m.content + token }
          : m,
      ),
    );
  }, []);

  /** 收尾：可选地用 patch 给最后一条助手消息补元数据（如引用来源）。 */
  const finishTurn = useCallback(
    (patch?: (last: T) => Partial<T>) => {
      setMessages((prev) =>
        patch
          ? prev.map((m, i) =>
              i === prev.length - 1 && m.role === "assistant"
                ? { ...m, ...patch(m) }
                : m,
            )
          : prev,
      );
    },
    [],
  );

  /** 失败时丢弃空的助手气泡，避免留下空气泡与污染历史。 */
  const discardEmptyTurn = useCallback(() => {
    setMessages((prev) =>
      prev.filter(
        (m, i) => !(i === prev.length - 1 && m.role === "assistant" && !m.content),
      ),
    );
  }, []);

  return {
    messages,
    setMessages,
    currentSessionId,
    ensureSession,
    beginTurn,
    appendToken,
    finishTurn,
    discardEmptyTurn,
  };
}
