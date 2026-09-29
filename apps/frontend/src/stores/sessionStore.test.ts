// src/stores/sessionStore.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./sessionStore";

// persist 中间件在建 store 时就要读写 localStorage，而测试跑在 node 环境。
// 先桩好再动态 import：静态 import 会被提升，store 会在桩之前就求值。
const backing = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: () => null,
  length: 0,
};
vi.stubGlobal("localStorage", localStorageStub);
// zustand 的默认存储是先看 window 再看 localStorage，只桩 localStorage 会一直报
// "storage is currently unavailable"，写盘被静默跳过
vi.stubGlobal("window", { localStorage: localStorageStub });

const { default: useSessionStore } = await import("./sessionStore");
const { conversationAPI } = await import("../api/converstion");

const at = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const session = (id: string, mode: Session["mode"], daysAgo: number): Session => ({
  id,
  title: id,
  mode,
  messages: [],
  createdAt: at(daysAgo),
  updatedAt: at(daysAgo),
});

const seed = (currentSessionId: string | null) =>
  useSessionStore.setState({
    sessions: [session("llm-1", "llm", 2), session("llm-2", "llm", 1), session("rag-1", "rag", 0)],
    currentSessionId,
  });

beforeEach(() => seed("rag-1"));

describe("deleteSession 的后继会话", () => {
  // /rag 页面删掉当前检索会话时，曾经会跳到一条「对话」会话上
  it("没有同模式后继时置空，而不是跨模式挑第一条", () => {
    useSessionStore.getState().deleteSession("rag-1");
    const state = useSessionStore.getState();
    expect(state.currentSessionId).toBeNull();
    expect(state.sessions.map((s) => s.id)).toEqual(["llm-1", "llm-2"]);
  });

  it("同模式还有别的会话时选它作后继", () => {
    seed("llm-1");
    useSessionStore.getState().deleteSession("llm-1");
    expect(useSessionStore.getState().currentSessionId).toBe("llm-2");
  });

  it("删的不是当前会话时不动 currentSessionId", () => {
    useSessionStore.getState().deleteSession("llm-1");
    expect(useSessionStore.getState().currentSessionId).toBe("rag-1");
  });
});

describe("renameSession", () => {
  it("只改目标会话的标题", () => {
    useSessionStore.getState().renameSession("llm-2", "改过的名字");
    const state = useSessionStore.getState();
    expect(state.sessions.find((s) => s.id === "llm-2")?.title).toBe("改过的名字");
    expect(state.sessions.find((s) => s.id === "llm-1")?.title).toBe("llm-1");
  });
});

describe("createSession 的空白单例", () => {
  const blank = (id: string, mode: Session["mode"]): Session => ({
    id,
    title: "",
    mode,
    messages: [],
    createdAt: at(0),
    updatedAt: at(0),
  });

  it("已有一条没写过、也没改过名的空白会话时回到它，不新建、不打后端", async () => {
    useSessionStore.setState({
      sessions: [blank("draft-1", "llm"), session("llm-1", "llm", 1)],
      currentSessionId: "llm-1",
    });
    const create = vi.spyOn(conversationAPI, "create").mockResolvedValue({ id: "should-not-happen" });

    const id = await useSessionStore.getState().createSession("llm");

    expect(id).toBe("draft-1");
    expect(create).not.toHaveBeenCalled();
    const state = useSessionStore.getState();
    expect(state.currentSessionId).toBe("draft-1");
    expect(state.sessions).toHaveLength(2);
    create.mockRestore();
  });

  it("连点三次 + 也只有一条空白草稿", async () => {
    useSessionStore.setState({ sessions: [], currentSessionId: null });
    const create = vi
      .spyOn(conversationAPI, "create")
      .mockImplementation(async () => ({ id: `row-${Math.random()}` }));

    const ids = [
      await useSessionStore.getState().createSession("llm"),
      await useSessionStore.getState().createSession("llm"),
      await useSessionStore.getState().createSession("llm"),
    ];

    expect(new Set(ids).size).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().sessions).toHaveLength(1);
    create.mockRestore();
  });

  it("草稿写过内容后，+ 才能开下一条", async () => {
    useSessionStore.setState({ sessions: [], currentSessionId: null });
    const create = vi
      .spyOn(conversationAPI, "create")
      .mockResolvedValueOnce({ id: "a" })
      .mockResolvedValueOnce({ id: "b" });

    const first = await useSessionStore.getState().createSession("llm");
    useSessionStore.getState().beginTurn(first, "你好");
    const second = await useSessionStore.getState().createSession("llm");

    expect(second).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
    create.mockRestore();
  });

  it("按模式分别计：检索的草稿不挡对话的新建", async () => {
    useSessionStore.setState({
      sessions: [blank("rag-draft", "rag")],
      currentSessionId: "rag-draft",
    });
    const create = vi.spyOn(conversationAPI, "create").mockResolvedValue({ id: "llm-new" });

    expect(await useSessionStore.getState().createSession("llm")).toBe("llm-new");
    expect(await useSessionStore.getState().createSession("rag")).toBe("rag-draft");
    expect(create).toHaveBeenCalledTimes(1);
    create.mockRestore();
  });
});
