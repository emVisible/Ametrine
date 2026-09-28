// src/utils/pageTitles.test.ts
import { describe, expect, it } from "vitest";
import { pageTitleForPath } from "./pageTitles";

describe("pageTitleForPath", () => {
  it.each([
    ["/dashboard", "概览"],
    ["/chat/abc", "对话"],
    ["/rag/abc", "检索问答"],
    ["/admin/vector", "知识库"],
    ["/admin/vector/6/12", "知识库"],
    ["/admin/access", "组织与权限"],
    ["/settings", "系统设置"],
    ["/profile", "个人资料"],
    ["/403", "无权访问"],
  ] as const)("%s → %s", (path, label) => {
    expect(pageTitleForPath(path)).toBe(label);
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
