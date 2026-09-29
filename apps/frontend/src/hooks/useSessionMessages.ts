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
  const switchSession = useSessionStore((s) => s.switchSession);

  // messages 必须和「它属于哪个会话」绑在同一个 state 里。
  // 分成两份存过：切换会话的那一次 commit 中，同步 effect 已经 setMessages(新会话的数组)，
  // 但同批次的写回 effect 拿到的仍是**这次渲染的旧闭包**（上一个会话的 messages），
  // 于是把上一个会话的内容写进了刚切到的会话 —— 点任何会话看到的都是同一份记录，
  // 表现就是「侧边栏点不进去」；点「+」新建会话同样会被灌进旧消息。
  const [thread, setThread] = useState<{ ownerId: string | null; msgs: T[] }>(
    () => {
      const state = useSessionStore.getState();
      const id = convId ?? state.currentSessionId ?? null;
      const session = state.sessions.find((s) => s.id === id);
      return { ownerId: id, msgs: [...(session?.messages ?? [])] } as {
        ownerId: string | null;
        msgs: T[];
      };
    },
  );
  const messages = thread.msgs;

  // 对外仍暴露 setMessages（Chat 页用它做远端历史回填与收尾 patch）
  const setMessages = useCallback(
    (updater: T[] | ((prev: T[]) => T[])) =>
      setThread((t) => ({
        ...t,
        msgs: typeof updater === "function" ? updater(t.msgs) : [...updater],
      })),
    [],
  );

  // 同一路由内切会话不再重挂载，所以消息要跟着会话走。
  // 这里用 React 官方的「渲染期对齐」而不是 effect：effect 会晚一拍 —— 切会话的那一次
  // commit 里，写回 effect 仍拿着上一个会话的 messages，于是把旧会话的记录灌进新会话，
  // 表现为「侧边栏点哪个会话都是同一份对话」。
  const activeKey = currentSessionId ?? convId ?? null;
  if (thread.ownerId !== activeKey) {
    const session = useSessionStore
      .getState()
      .sessions.find((s) => s.id === activeKey);
    setThread({
      ownerId: activeKey,
      msgs: [...((session?.messages ?? []) as unknown as T[])],
    });
  }

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

  // 写回外部 store：只允许写「确实属于当前会话」的那份消息，
  // 否则切会话的那一次 commit 会把上一个会话的记录灌进新会话（就是侧栏点不进去的根因）。
  useEffect(() => {
    if (!currentSessionId || thread.ownerId !== currentSessionId) return;
    if (messages.length === 0) return;
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
  }, [messages, currentSessionId, thread.ownerId]);

  // 自动命名同理：只有归属对上了才敢用首条消息当标题。
  useEffect(() => {
    if (!currentSessionId || thread.ownerId !== currentSessionId) return;
    const first = messages.find((m) => m.role === "user");
    if (!first?.content) return;
    const session = useSessionStore
      .getState()
      .sessions.find((s) => s.id === currentSessionId);
    if (session?.title === "新对话") {
      useSessionStore.getState().renameSession(currentSessionId, first.content.slice(0, 40));
    }
  }, [messages, currentSessionId, thread.ownerId]);

  /** 追加一轮「用户提问 + 空的助手气泡」，返回本次的历史快照。 */
  const beginTurn = useCallback(
    (prompt: string) => {
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      setThread((t) => ({
        ...t,
        msgs: [
          ...t.msgs,
          { role: "user", content: prompt, date: new Date().toISOString() },
          { role: "assistant", content: "" },
        ] as unknown as T[],
      }));
      return history;
    },
    [messages],
  );

  /** 把 token 追加到最后一条助手消息上。 */
  const appendToken = useCallback((token: string) => {
    setThread((t) => ({
      ...t,
      msgs: t.msgs.map((m, i) =>
        i === t.msgs.length - 1 && m.role === "assistant"
          ? { ...m, content: m.content + token }
          : m,
      ),
    }));
  }, []);

  /** 收尾：可选地用 patch 给最后一条助手消息补元数据（如引用来源）。 */
  const finishTurn = useCallback(
    (patch?: (last: T) => Partial<T>) => {
      setThread((t) => ({
        ...t,
        msgs: patch
          ? t.msgs.map((m, i) =>
              i === t.msgs.length - 1 && m.role === "assistant"
                ? { ...m, ...patch(m) }
                : m,
            )
          : t.msgs,
      }));
    },
    [],
  );

  /** 失败时丢弃空的助手气泡，避免留下空气泡与污染历史。 */
  const discardEmptyTurn = useCallback(() => {
    setThread((t) => ({
      ...t,
      msgs: t.msgs.filter(
        (m, i) => !(i === t.msgs.length - 1 && m.role === "assistant" && !m.content),
      ),
    }));
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
