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
const { setLang, translate } = await import("../i18n");

// 这些文案是失败时用户唯一能看到的指引，回退成「HTTP 500」等于把人推进黑箱。
// 断言写成「等于当前语言里的那条字典项」，所以两种语言都必须各自有一条可行动的指引。
const MAP: Record<number, string> = {
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
