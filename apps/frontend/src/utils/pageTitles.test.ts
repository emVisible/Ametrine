// src/utils/pageTitles.test.ts
import { describe, expect, it } from "vitest";
import { pageTitleForPath } from "./pageTitles";

// 这里断言的是「文案键」而不是成品文案：键跨语言稳定，
// 具体措辞归 i18n 字典管。
describe("pageTitleForPath", () => {
  it.each([
    ["/dashboard", "page.dashboard"],
    ["/chat/abc", "page.chat"],
    ["/rag/abc", "page.rag"],
    ["/admin/vector", "page.vector"],
    ["/admin/vector/6/12", "page.vector"],
    ["/admin/access", "page.access"],
    ["/admin/queue", "page.queue"],
    ["/admin/inference", "page.inference"],
    ["/admin/tenants/7", "page.tenantDetail"],
    ["/settings", "page.settings"],
    ["/profile", "page.profile"],
    ["/403", "page.forbidden"],
  ] as const)("%s → %s", (path, key) => {
    expect(pageTitleForPath(path)).toBe(key);
  });

  it("未知路径不猜标题", () => {
    expect(pageTitleForPath("/somewhere-else")).toBeNull();
  });

  // "/chat" 前缀匹配会把 "/chats" 也认成对话页，这类误伤要挡住
  it("段首匹配，不做裸前缀匹配", () => {
    expect(pageTitleForPath("/chats")).toBeNull();
    expect(pageTitleForPath("/settingsx")).toBeNull();
  });
});
