// src/stores/streamStore.ts
// 会话级流式注册表：「谁在生成」和「谁出错了」属于**会话**，不属于正在看会话的那个组件。
//
// 之前这两个状态是 Chat / RAGChat 组件里的 useState + useRef(AbortController)：
// 组件卸载（切会话、跳路由）时 effect 清理会 abort 掉正在进行的流，
// 而 token 回调又闭包绑在「当时那份 messages state」上 ——
// 于是切走 = 打断，切回来 = 空气泡或半截内容，甚至把 A 的回复渲染进 B。
//
// AbortController 放在模块级 Map 而不是 zustand state：它不是渲染数据，
// 放进 state 只会让每次 start/stop 多一次无意义的订阅者通知。
import { create } from "zustand";

interface StreamState {
  /** sessionId -> 正在流式输出 */
  active: Record<string, true>;
  /** sessionId -> 失败提示；按会话隔离，切会话不会看到别人的报错 */
  errors: Record<string, string>;
}

interface StreamActions extends StreamState {
  markActive: (id: string) => void;
  markIdle: (id: string) => void;
  markError: (id: string, message: string) => void;
  clearError: (id: string) => void;
}

const drop = <T,>(record: Record<string, T>, id: string) => {
  if (!(id in record)) return record;
  const next = { ...record };
  delete next[id];
  return next;
};

const useStreamStore = create<StreamActions>()((set, get) => ({
  active: {},
  errors: {},
  markActive: (id) => set({ active: { ...get().active, [id]: true } }),
  markIdle: (id) => set({ active: drop(get().active, id) }),
  markError: (id, message) =>
    set({
      active: drop(get().active, id),
      errors: { ...get().errors, [id]: message },
    }),
  clearError: (id) => set({ errors: drop(get().errors, id) }),
}));

const controllers = new Map<string, AbortController>();

/**
 * 为某条会话开一路流：返回它的 AbortController（用于 fetch signal）。
 * 已经在生成就返回 null —— 同一条会话不该并发写同一个助手气泡。
 */
export function beginStream(id: string): AbortController | null {
  if (useStreamStore.getState().active[id] || controllers.has(id)) return null;
  const controller = new AbortController();
  controllers.set(id, controller);
  useStreamStore.getState().markActive(id);
  return controller;
}

/** 流自然结束：解除「生成中」。出错改用 failStream，顺带记下这条会话的错误。 */
export function endStream(id: string) {
  controllers.delete(id);
  useStreamStore.getState().markIdle(id);
}

/** 流失败：不 abort（已经结束了），只登记错误并解除「生成中」。 */
export function failStream(id: string, message: string) {
  controllers.delete(id);
  useStreamStore.getState().markError(id, message);
}

/** 用户按下停止：只打断这一条会话，其余在途的流继续跑。 */
export function stopStream(id: string) {
  controllers.get(id)?.abort();
  controllers.delete(id);
  useStreamStore.getState().markIdle(id);
}

export default useStreamStore;
