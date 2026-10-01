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
//
// 段内允许驼峰（[A-Za-z]）：字典几乎全是 admin.access.pageDesc 这种形状，
// 上一版这里写的是 [a-z][a-z0-9]*，于是**每一个以大写段结尾的键都被整体跳过**，
// 这条审计实际上只覆盖了少数键 —— 补上驼峰后一次性暴露出几十个漏翻。
const CALL =
  /\bt(?:ranslate)?\(\s*(?:[A-Za-z_]\w*\s*,\s*)?["']([a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)["']/g;

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

/**
 * 第二条更宽的扫描：键**被存进查表常量再传给 t()** 的情况。
 *
 * 上一版只匹配 `t("a.b")` 这种直接调用，于是 `AdminTenantDetail.tsx` 里的
 * `LEVEL_LABELS = { manage: "admin.access.grantManage" }` 整组键逃过审计，
 * 而那个键在两种语言的字典里都不存在 —— 浏览器里实测：租户子页面 10 行授权
 * 全部把裸键 `admin.access.grantManage` 显示给管理员（translate 的兜底就是原样返回键名）。
 * 判据收得比 CALL 宽，但用「首段必须是字典的顶层键 + 排除文件名」滤掉误报。
 */
const TOP_LEVEL = new Set(Object.keys(zh));
const PATH_LITERAL =
  /["']([a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)["']/g;
const FILE_EXT = /\.(ts|tsx|js|jsx|json|md|py|css|txt|sh|svg|png)$/;

const looseMissing: string[] = [];
const looseSeen = new Set<string>();

for (const [file, text] of Object.entries(sources)) {
  if (SKIP.test(file)) continue;
  for (const match of text.matchAll(PATH_LITERAL)) {
    const path = match[1];
    if (!path || FILE_EXT.test(path)) continue;
    if (!TOP_LEVEL.has(path.split(".")[0] as string)) continue;
    looseSeen.add(path);
    if (!has(zh, path) || !has(en, path)) looseMissing.push(`${path}  (${file})`);
  }
}

describe("i18n 字典", () => {
  // 正则一旦失效，后面两条就都是空跑；先证明扫描本身有效
  it("扫到了足够多的字面量文案路径", () => {
    expect(seen.size).toBeGreaterThan(80);
  });

  it("每个字面量路径在中英文字典里都存在", () => {
    expect(missing).toEqual([]);
  });

  it("藏在查表常量里的键也被扫到了（不只是 t() 直调）", () => {
    // 宽扫描必须比窄扫描多覆盖东西，否则说明这条新审计是空转的
    expect(looseSeen.size).toBeGreaterThan(seen.size);
    expect([...looseSeen].some((p) => !seen.has(p))).toBe(true);
  });

  it("查表常量里的键在中英文字典里也都存在", () => {
    expect(looseMissing).toEqual([]);
  });

  it("中英文字典的键形状完全一致（漏翻直接红）", () => {
    expect(shape(en).sort()).toEqual(shape(zh).sort());
  });
});
