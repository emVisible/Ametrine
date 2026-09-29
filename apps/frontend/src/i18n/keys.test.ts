// src/i18n/keys.test.ts
// 字典键的机械校验：t() 的取值路径是普通字符串，写错一个字母 tsc 也不会管，
// 而 translate() 的兜底是「原样返回键名」—— 界面上就会出现 dash.title 这种碎片。
// 这里用 Vite 的 import.meta.glob 把所有源码按原文扫一遍，
// 要求每个字面量路径在两种语言里都真的存在（不走 node:fs，测试的 tsconfig 没有 node 类型）。
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { zh } from "./zh";

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function has(dict: unknown, path: string): boolean {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      dict,
    ) !== undefined;
}

// t("a.b") / t('a.b') / translate(lang, "a.b")。带 ${} 的动态路径匹配不到，属于预期跳过。
const CALL = /\bt(?:ranslate)?\(\s*(?:[A-Za-z_]\w*\s*,\s*)?["']([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)["']/g;

const SKIP = /i18n[/\\](zh|en|index|context)\.ts$|i18n[/\\]keys\.test\.ts$/;

const missing: string[] = [];
const seen = new Set<string>();

for (const [file, text] of Object.entries(sources)) {
  if (SKIP.test(file)) continue;
  for (const match of text.matchAll(CALL)) {
    const path = match[1];
    if (!path) continue;
    seen.add(path);
    if (!has(zh, path) || !has(en, path)) missing.push(`${path}  (${file})`);
  }
}

const shape = (o: unknown, prefix = ""): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : shape(v, `${prefix}${k}.`),
  );

describe("i18n 字典", () => {
  // 正则一旦失效，后面两条就都是空跑；先证明扫描本身有效
  it("扫到了足够多的字面量文案路径", () => {
    expect(seen.size).toBeGreaterThan(80);
  });

  it("每个字面量路径在中英文字典里都存在", () => {
    expect(missing).toEqual([]);
  });

  it("中英文字典的键形状完全一致（漏翻直接红）", () => {
    expect(shape(en).sort()).toEqual(shape(zh).sort());
  });
});
