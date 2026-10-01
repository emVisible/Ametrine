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

/**
 * 全部合法文案键（点号叶子路径），由 `zh` 的实际形状推导。
 *
 * 存在的原因是一次真实缺陷（交接文档 §3.10 缺陷 1）：租户子页面把裸键
 * `admin.access.grantManage` 显示给了管理员 —— 那个键在两份字典里都不存在，
 * 而 `translate()` 的兜底是「原样返回键名」。
 *
 * 静态扫描（keys.test.ts）修不了这一类：它只能匹配字面量，而键是**先存进查表常量、
 * 再传给 t()** 的，常量声明成 `Record<string, string>` 时扫描与 tsc 都不知道它是文案键。
 * 真正的根因是 `t(path: string)` 这条签名 —— 文案键在类型层面和普通字符串没有区别。
 * 所以这里把键收窄成联合类型：写错的**字面量**在 tsc 阶段就红，
 * 而动态拼键必须落到一张标注了 `MsgKey` 的表上（于是它既可编译检查、也可 grep）。
 */
export type MsgKey = LeafKeys<Dict>;

type LeafKeys<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends object
      ? `${K}.${LeafKeys<T[K]>}`
      : never;
}[keyof T & string];

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

/**
 * 缺键上报：同一个键只吼一次。
 *
 * 键缺失是缺陷而不是文案差异，以前它唯一的表征是界面上多出一截裸键名 ——
 * 静默、且不告诉你是谁写错的。类型收窄之后仍然可能有漏网的（动态拼出来的键、
 * 或显式 `as MsgKey`），所以运行时这一道保留。
 */
const reportedMissing = new Set<string>();

function reportMissing(path: string): void {
  if (reportedMissing.has(path)) return;
  reportedMissing.add(path);
  console.error(
    `[i18n] 缺失文案键 "${path}"：中英文字典里都没有，界面将显示裸键名`,
  );
}

export function translate(lang: Lang, path: MsgKey, vars?: TVars): string {
  let text = lookup(DICTS[lang], path) ?? lookup(DICTS[DEFAULT_LANG], path);
  if (text === undefined) {
    reportMissing(path);
    return path;
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** 非组件环境用（api 层、title）。组件内一律用 useI18n().t。 */
export function t(path: MsgKey, vars?: TVars): string {
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
