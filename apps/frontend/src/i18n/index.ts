// src/i18n/index.ts
// 中英双语的最小实现：字典 + 点号取值 + {变量} 插值。
//
// 为什么不引 i18next：这是个单人本地部署的应用，需要的只有「字典切换 + 插值 + 持久化 +
// <html lang>」四件事，自己实现约 100 行、零依赖、零网络安装风险；i18next 的复数/命名空间
// 懒加载在这里都用不上。代价是没有 ICU 消息格式，复数只能靠分支——本项目文案不涉及。
//
// 关键约束：en.ts 的类型是 typeof zh，所以**漏翻任何一个键都会在 tsc 阶段报错**，
// 不会出现「切到英文后一半界面还是中文」的静默降级。
import { zh } from "./zh";
import { en } from "./en";

export type Lang = "zh-CN" | "en";

export const LANG_STORAGE_KEY = "ametrine-lang";

export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: "zh-CN", label: "中文", short: "中" },
  { id: "en", label: "English", short: "EN" },
];

export const DEFAULT_LANG: Lang = "zh-CN";

type Dict = typeof zh;

const DICTS: Record<Lang, Dict> = { "zh-CN": zh, en };

function readStoredLang(): Lang | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v === "zh-CN" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function detectLang(): Lang {
  const stored = readStoredLang();
  if (stored) return stored;
  // node（vitest）里没有 navigator：语言环境只在浏览器里推断
  if (typeof navigator === "undefined") return DEFAULT_LANG;
  const candidates: readonly string[] = navigator.languages ?? [
    navigator.language ?? "",
  ];
  for (const c of candidates) {
    if (/^zh\b|^zh-/i.test(c)) return "zh-CN";
    if (/^en\b|^en-/i.test(c)) return "en";
  }
  return DEFAULT_LANG;
}

// 模块级当前语言：给非组件环境（api 层的错误文案、document.title）用。
// 初值在导入时就从 localStorage / 浏览器语言解析好，
// 否则首屏由非组件代码产生的文案（title、拦截器报错）会先闪一下中文。
let currentLang: Lang = detectLang();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(next: Lang) {
  currentLang = next;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    }
  } catch {
    /* 隐私模式下 localStorage 会抛，语言只在本次会话内生效 */
  }
  // <html lang> 影响读屏发音与浏览器翻译提示；node（vitest）里没有 document
  if (typeof document !== "undefined") document.documentElement.lang = next;
}
function lookup(dict: unknown, path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      dict,
    );
  return typeof value === "string" ? value : undefined;
}

export type TVars = Record<string, string | number>;

export function translate(lang: Lang, path: string, vars?: TVars): string {
  let text = lookup(DICTS[lang], path) ?? lookup(DICTS[DEFAULT_LANG], path);
  if (text === undefined) return path;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** 非组件环境用（api 层、title）。组件内一律用 useI18n().t。 */
export function t(path: string, vars?: TVars): string {
  return translate(currentLang, path, vars);
}

/**
 * 数字/日期/排序用的 BCP-47 区域设置，跟着界面语言走。
 * 以前全站硬编码 "zh-CN"，于是切到英文后概览仍然写着「2026年9月29日星期二」——
 * 文案翻了、格式没翻，这种半中半英比整页中文更像 bug。
 */
const LOCALES: Record<Lang, string> = { "zh-CN": "zh-CN", en: "en-US" };

export function intlLocale(): string {
  return LOCALES[currentLang];
}
