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

const { describeStatus } = await import("./chat");

// 这些文案是失败时用户唯一能看到的指引，回退成「HTTP 500」等于把人推进黑箱
describe("describeStatus", () => {
  it.each([
    [401, "登录"],
    [403, "权限"],
    [404, "不存在"],
    [500, "重试"],
    [502, "不可用"],
    [504, "不可用"],
  ] as const)("%i 给出可行动的中文指引", (status, keyword) => {
    expect(describeStatus(status)).toContain(keyword);
  });

  it("未知状态码至少带上状态码本身", () => {
    expect(describeStatus(418)).toContain("418");
  });
});
