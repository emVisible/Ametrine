// src/hooks/useSessionMessages.ts
// Chat 与 RAGChat 共用的会话绑定。
//
// 会话是**首次发送时**才创建的：以前裸 /chat、/rag 一进来就 createSession，
// 光是访问路由就会在库里留下一条没人写过的 Conversation（删掉账号也删不掉）。
// 现在裸路由保持 currentSessionId = null，发送前才补建并把 URL 换过去。
//
// 这里**不再持有 messages 的本地副本**。store 是唯一事实源：
// 后台会话的流式回调按会话 id 写 store，本地镜像看不见它，
// 切回来就是空气泡或半截内容；更糟的是原来的写回 effect 会拿旧镜像覆盖 store，
// 把上一个会话的记录灌进刚切到的会话（表现就是「点哪个会话都是同一份对话」）。
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import useSessionStore, {
  type HistoryMessage,
  type Session,
} from "../stores/sessionStore";
import useStreamStore from "../stores/streamStore";

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
  const sessionId = currentSessionId ?? convId ?? null;

  // 选整个 session 对象而不是直接选 messages 数组：数组缺失时 `?? []` 会每次产生新引用，
  // useSyncExternalStore 会当成「快照一直变」而无限重渲染。
  // 还要求 mode 相同：currentSessionId 只是「侧栏最后打开的那条」，
  // 它指向对话会话时，/rag 页面不能把那段对话当成自己的历史画出来。
  const session = useSessionStore((s) =>
    s.sessions.find((x) => x.id === sessionId && x.mode === mode),
  );
  // useMemo 而不是直接 `?? []`：effect 依赖 messages，新数组字面量会让依赖每次都变
  const messages = useMemo(() => (session?.messages ?? []) as T[], [session]);

  const streaming = useStreamStore((s) =>
    sessionId ? s.active[sessionId] === true : false,
  );
  const error = useStreamStore((s) =>
    sessionId ? (s.errors[sessionId] ?? null) : null,
  );

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
    if (reusable) {
      if (state.currentSessionId !== reusable.id)
        switchSession(reusable.id);
      navigate(`/${MODE_ROUTE[mode]}/${reusable.id}`, { replace: true });
      return;
    }
    // 同模式一条都没有：必须把指针从「别的模式」上摘下来，否则 currentSessionId
    // 还指着对话会话，检索页会拿它当自己的会话发消息（裸路由 + null 才是合法空态）
    if (state.currentSessionId) switchSession(null);
    // 裸路由 + currentSessionId 为空是合法空态，会话等 handleSubmit 里 ensureSession() 去建。
  }, [convId, currentSessionId, mode, navigate, switchSession]);

  // 上一轮刷新/关页时留下的空助手气泡：现在没有流在跑，就该收掉，
  // 否则它会一直显示成「卡住的生成中」。
  useEffect(() => {
    if (!sessionId || streaming) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && !last.content) {
      useSessionStore.getState().discardEmptyTurn(sessionId);
    }
  }, [sessionId, streaming, messages]);

  /**
   * 拿到一个可用的会话 ID：有就用，没有才建。
   * 返回 null 只可能是 createSession 抛错（store 内部已降级为本地 UUID，一般不会）。
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    const state = useSessionStore.getState();
    // 只认同模式的会话：currentSessionId 可能指着对话会话，而这里是检索页
    const existing = [convId, state.currentSessionId].find(
      (id) => id && state.sessions.some((s) => s.id === id && s.mode === mode),
    );
    if (existing) {
      if (state.currentSessionId !== existing) switchSession(existing);
      return existing;
    }
    const id = await state.createSession(mode);
    navigate(`/${MODE_ROUTE[mode]}/${id}`, { replace: true });
    return id;
  }, [convId, mode, navigate, switchSession]);

  /** 本地 store 丢了（换设备或清缓存）时从后端回灌。 */
  const setMessages = useCallback(
    (next: T[]) => {
      if (sessionId) {
        useSessionStore.getState().setMessages(sessionId, next as HistoryMessage[]);
      }
    },
    [sessionId],
  );

  const clearError = useCallback(() => {
    if (sessionId) useStreamStore.getState().clearError(sessionId);
  }, [sessionId]);

  return {
    messages,
    sessionId,
    streaming,
    error,
    ensureSession,
    setMessages,
    clearError,
  };
}
