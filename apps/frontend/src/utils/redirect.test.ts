// src/utils/redirect.test.ts
import { describe, expect, it } from "vitest";
import { safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it("放行站内深链，包括带查询串的", () => {
    expect(safeRedirect("/admin/vector/6/9")).toBe("/admin/vector/6/9");
    expect(safeRedirect("/rag/abc?mode=full")).toBe("/rag/abc?mode=full");
  });

  // 这几条是安全边界：协议相对与反斜杠写法都会被浏览器解析成站外地址
  it("拒掉协议相对地址", () => {
    expect(safeRedirect("//evil.com/x")).toBe("/dashboard");
    expect(safeRedirect("/\\evil.com")).toBe("/dashboard");
  });

  it("拒掉绝对 URL 与非字符串", () => {
    expect(safeRedirect("https://evil.com")).toBe("/dashboard");
    expect(safeRedirect("javascript:alert(1)")).toBe("/dashboard");
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(safeRedirect(bad)).toBe("/dashboard");
    }
  });

  it("来路是登录或注册页时回默认页，避免自我跳转", () => {
    expect(safeRedirect("/login")).toBe("/dashboard");
    expect(safeRedirect("/register?next=1")).toBe("/dashboard");
  });

  it("可以指定别的兜底页", () => {
    expect(safeRedirect(undefined, "/profile")).toBe("/profile");
  });
});
