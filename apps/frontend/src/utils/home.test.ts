import { describe, expect, it } from "vitest";
import { homePathFor } from "./home";

describe("homePathFor", () => {
  it("个人租户落在个人页", () => {
    expect(homePathFor({ tenant_mode: "personal" })).toBe("/personal");
  });

  it("知识库租户与未加载用户落在概览", () => {
    expect(homePathFor({ tenant_mode: "knowledge" })).toBe("/dashboard");
    expect(homePathFor(null)).toBe("/dashboard");
    expect(homePathFor(undefined)).toBe("/dashboard");
  });
});
