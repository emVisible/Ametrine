// src/i18n/I18nProvider.tsx
// 这个文件只导出组件（Provider 与 LangSwitcher）：useI18n 在 ./context.ts，
// 混在一起会让 react-refresh 放弃 HMR、每次改动都整页重载。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LANGS,
  detectLang,
  setLang as persistLang,
  translate,
  type Lang,
  type MsgKey,
  type TVars,
} from "./index";
import { I18nCtx, useI18n } from "./context";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, choose] = useState<Lang>(() => detectLang());

  // 模块级 currentLang 也要跟着走：api 层的错误文案、document.title 都读它
  useEffect(() => {
    persistLang(lang);
  }, [lang]);

  const t = useCallback(
    (path: MsgKey, vars?: TVars) => translate(lang, path, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang: choose, t }), [lang, t]);

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

/**
 * 语言切换控件：两枚分段按钮，与侧栏「对话 / 检索」同一套视觉。
 * 用 aria-pressed 而不是 role=tablist —— 它是「当前值」而不是「视图切换」。
 */
export function LangSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("app.language")}
      className="flex rounded-[--radius-md] bg-surface-sunken p-0.5"
    >
      {LANGS.map((l) => {
        const selected = l.id === lang;
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={selected}
            onClick={() => setLang(l.id)}
            className={`rounded-[--radius-sm] px-2 py-1 text-[11px] transition-ui ${
              selected
                ? "bg-surface font-medium text-ink shadow-card"
                : "text-ink-subtle hover:text-ink-muted"
            }`}
          >
            {compact ? l.short : l.label}
          </button>
        );
      })}
    </div>
  );
}
