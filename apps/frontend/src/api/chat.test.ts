// src/api/chat.test.ts
import { describe, expect, it, vi } from "vitest";

// chat.ts 经 useAuthStore 间接需要 localStorage（persist 中间件）
const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: () => null,
  length: 0,
});

const { describeStatus, buildCrossBaseSources, parseDataLine, readStream } =
  await import("./chat");
const { setLang, translate } = await import("../i18n");
import type { MsgKey } from "../i18n";

// 这些文案是失败时用户唯一能看到的指引，回退成「HTTP 500」等于把人推进黑箱。
// 断言写成「等于当前语言里的那条字典项」，所以两种语言都必须各自有一条可行动的指引。
const MAP: Record<number, MsgKey> = {
  400: "errors.badRequest",
  401: "errors.unauthorized",
  403: "errors.forbidden",
  404: "errors.notFound",
  500: "errors.serverError",
  502: "errors.unavailable",
  504: "errors.unavailable",
};

for (const lang of ["zh-CN", "en"] as const) {
  describe.each(Object.entries(MAP))(`describeStatus / ${lang} %s`, (status, key) => {
    it(`给出「${key}」而不是裸状态码`, () => {
      setLang(lang);
      expect(describeStatus(Number(status))).toBe(translate(lang, key));
      expect(describeStatus(Number(status))).not.toContain(String(status));
    });
  });
}

it("未知状态码至少带上状态码本身", () => {
  setLang("zh-CN");
  expect(describeStatus(418)).toContain("418");
});

// 跨库检索的 sources 是「用户可读的库 × 它们的集合」摊平结果。
// 它决定了后端是否走多路召回，也决定了会不会撞到 embedding 模型守卫，
// 所以这条映射必须是可测的纯函数，而不是藏在组件里靠视口去猜。
describe("buildCrossBaseSources", () => {
  const map = (entries: [number, { name: string }[]][]) =>
    new Map<number, { name: string }[]>(entries);

  it("多个库与集合时全部摊平成 sources", () => {
    const dbs = [
      { id: 7, name: "fffff" },
      { id: 10, name: "middle" },
    ];
    const cols = map([
      [7, [{ name: "a" }, { name: "aaa" }]],
      [10, [{ name: "core" }]],
    ]);
    expect(buildCrossBaseSources(dbs, cols)).toEqual([
      { database_name: "fffff", collection_name: "a" },
      { database_name: "fffff", collection_name: "aaa" },
      { database_name: "middle", collection_name: "core" },
    ]);
  });

  it("只有一路可选时返回 undefined —— 后端因此走原来的单库标量路径", () => {
    const dbs = [{ id: 10, name: "middle" }];
    const cols = map([[10, [{ name: "core" }]]]);
    expect(buildCrossBaseSources(dbs, cols)).toBeUndefined();
  });

  it("可读的库没有集合时不会凭空造出来源", () => {
    const dbs = [{ id: 1, name: "empty" }];
    expect(buildCrossBaseSources(dbs, map([]))).toBeUndefined();
  });

  it("集合缺失的库被跳过，不会留下 collection_name: undefined", () => {
    const dbs = [
      { id: 1, name: "nocols" },
      { id: 2, name: "has" },
    ];
    const cols = map([[2, [{ name: "c1" }, { name: "c2" }]]]);
    expect(buildCrossBaseSources(dbs, cols)).toEqual([
      { database_name: "has", collection_name: "c1" },
      { database_name: "has", collection_name: "c2" },
    ]);
  });
});

// 推理流的三种结局必须互斥。这一组不是假想：实测遇到过 gemma worker 触发
// `CUDA error: device-side assert triggered` 后进入 sticky 状态，此后每次
// /api/llm/rag 都是 HTTP 200 + 一个字节都没有 —— 旧实现把它读成「回答成功但为空」，
// 于是界面留下一条看起来正常的人形空白气泡。
describe("parseDataLine", () => {
  it("后端的 error 行是错误，不是一段内容", () => {
    expect(parseDataLine('{"error": "生成中断（错误编号 a1b2c3d4），这条请求请重试"}')).toEqual({
      kind: "error",
      message: "生成中断（错误编号 a1b2c3d4），这条请求请重试",
    });
  });

  it("SSE 帧与 NDJSON 行、字符串与 content 对象都能解出 token", () => {
    expect(parseDataLine('data: "Kubernetes"')).toEqual({ kind: "token", text: "Kubernetes" });
    expect(parseDataLine('{"content": "服务"}')).toEqual({ kind: "token", text: "服务" });
    expect(parseDataLine("普通文本")).toEqual({ kind: "token", text: "普通文本" });
  });

  it("空行、注释与 [DONE] 不产出任何事件", () => {
    expect(parseDataLine("")).toBeNull();
    expect(parseDataLine(": keep-alive")).toBeNull();
    expect(parseDataLine("data: [DONE]")).toBeNull();
    // 既没有 error 也没有 content 的元数据行不该被当成一个字
    expect(parseDataLine('{"references": []}')).toBeNull();
  });
});

describe("readStream", () => {
  // null 表示连接在那里异常中断（fetch 的 reader 会直接抛）
  function fake(chunks: (string | null)[]): Response {
    const queue = [...chunks];
    return {
      body: {
        getReader: () => ({
          read: async () => {
            const c = queue.shift();
            if (c === undefined) return { done: true, value: undefined };
            if (c === null) throw new TypeError("network failure");
            // 后端每块都是 `dumps(...) + "\n"`：行分隔符是流格式的一部分，
            // 少写一条换行就会把两块并成一行 JSON 解析失败、按纯文本发出去。
            const line = c.endsWith("\n") ? c : `${c}\n`;
            return { done: false, value: new TextEncoder().encode(line) };
          },
        }),
      },
    } as unknown as Response;
  }

  async function run(chunks: (string | null)[]) {
    setLang("zh-CN");
    const text: string[] = [];
    let completed = 0;
    let failure = "";
    await readStream(
      fake(chunks),
      (t) => text.push(t),
      () => {
        completed += 1;
      },
      (e) => {
        failure = e.message;
      },
    );
    return { text: text.join(""), completed, failure };
  }

  it("正常内容有 token：只走 onComplete", async () => {
    const r = await run(['"a"', '{"content":"b"}', "[DONE]\n"]);
    expect(r).toEqual({ text: "ab", completed: 1, failure: "" });
  });

  it("流里出现 error 行：走 onError，且不再报完成", async () => {
    const r = await run(['"前半句"', '{"error":"生成中断（错误编号 x1），这条请求请重试"}\n']);
    expect(r.text).toBe("前半句");
    expect(r.completed).toBe(0);
    expect(r.failure).toContain("生成中断");
  });

  it("200 却一个 token 都没有：这是失败，不是空回答", async () => {
    const r = await run([""]);
    expect(r.completed).toBe(0);
    expect(r.failure).toBe(translate("zh-CN", "errors.emptyStream"));
  });

  it("连接异常中断：报读流失败，而不是静默完成", async () => {
    const r = await run(['"半句"', null]);
    expect(r.completed).toBe(0);
    expect(r.failure).toBe("network failure");
  });
});
