// src/i18n/context.ts
// Context 与 useI18n 单独成文件：I18nProvider.tsx 里只剩组件导出，
// 否则 react-refresh 会因为「组件与非组件混在一个文件」而让 HMR 整页重载。
import { createContext, useContext } from "react";
import type { Lang, TVars } from "./index";

export interface I18nValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: (path: string, vars?: TVars) => string;
}

export const I18nCtx = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n 必须在 <I18nProvider> 内使用");
  return ctx;
}
