// src/hooks/useSessionMessages.ts
// Chat 与 RAGChat 共用的会话绑定。
// AppLayout 的 <main key={pathname}> 会在路由变化时重挂载子树，
// 因此会话切换用「惰性初始化 + 重挂载」即可，不需要 effect 把 store 同步进 state
// （那种写法会触发级联渲染，也是 lint 报 set-state-in-effect 的根因）。
import { useCallback, useEffect, useState } from "react";
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
  const createSession = useSessionStore((s) => s.createSession);
  const switchSession = useSessionStore((s) => s.switchSession);

  const [messages, setMessages] = useState<T[]>(() => {
    const session = useSessionStore.getState().sessions.find(
      (s) => s.id === (convId ?? useSessionStore.getState().currentSessionId),
    );
    return (session?.messages ?? []) as T[];
  });

  // URL 与 store 必须双向自洽：convId 可能指向一个已被删除（或属于另一种模式）的会话，
  // 无条件 switchSession(convId) 会把这种幽灵 ID 重新写回 store，于是删除看似没生效。
  useEffect(() => {
    const state = useSessionStore.getState();
    const target = convId
      ? state.sessions.find((s) => s.id === convId && s.mode === mode)
      : null;

    if (target) {
      if (state.currentSessionId !== target.id) switchSession(target.id);
      return;
    }

    const reusable = state.sessions.find((s) => s.mode === mode);
    if (reusable) {
      switchSession(reusable.id);
      navigate(`/${MODE_ROUTE[mode]}/${reusable.id}`, { replace: true });
    } else {
      createSession(mode).then((id) =>
        navigate(`/${MODE_ROUTE[mode]}/${id}`, { replace: true }),
      );
    }
  }, [convId, currentSessionId, createSession, mode, navigate, switchSession]);

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
    beginTurn,
    appendToken,
    finishTurn,
    discardEmptyTurn,
  };
}
