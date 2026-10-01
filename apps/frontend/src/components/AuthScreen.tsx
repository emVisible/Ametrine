// src/components/AuthScreen.tsx
// 登录与注册共用同一套版式：品牌标识、双色晶体背景、主题与语言切换、卡片容器。
import { useEffect, type ReactNode } from "react";
import brandIcon from "../assets/icon.png";
import { LangSwitcher } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/context";
import type { MsgKey } from "../i18n";
import { useTheme } from "../hooks/useTheme";
import { applyDocumentTitle } from "../utils/pageTitles";
import { ArrowLeftIcon, MoonIcon, Spinner, SunIcon, WarningIcon } from "./icons";

export function AuthScreen({
  titleKey,
  taglineKey,
  returnToKey,
  children,
  footer,
  error,
}: {
  /** 文案键而不是成品文字：语言切换后要能整体重渲染 */
  titleKey: MsgKey;
  taglineKey: MsgKey;
  /** 被守卫拦下来时，登录后会去的那个页面的文案键 */
  returnToKey?: MsgKey | null;
  children: ReactNode;
  footer?: ReactNode;
  error?: string | null;
}) {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();

  // t 随语言变化，所以标题在切语言的那一次 commit 就跟上
  useEffect(() => {
    applyDocumentTitle(t(titleKey));
  }, [t, titleKey]);

  return (
    <div className="relative flex min-h-screen flex-col bg-canvas">
      {/* 背景是「同一块晶体上的两束光」：紫罗兰 + 琥珀，纯装饰，读屏跳过 */}
      <div className="a-auth-scene" aria-hidden>
        <div className="a-auth-glow a-auth-glow-violet" />
        <div className="a-auth-glow a-auth-glow-amber" />
        <div className="a-auth-facets" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-7 flex items-center gap-2.5">
          <img src={brandIcon} alt="" className="h-7 w-7" />
          <span className="text-[--text-xl] font-semibold tracking-[-0.015em] text-ink">
            {t("app.name")}
          </span>
        </div>

        <div className="a-card w-full max-w-[22rem] bg-surface/85 px-5 py-5 shadow-card supports-[backdrop-filter]:backdrop-blur-[3px]">
          <h1 className="text-[--text-lg] font-semibold text-ink">{t(titleKey)}</h1>
          <p className="mt-0.5 text-[--text-sm] text-ink-muted">{t(taglineKey)}</p>

          {returnToKey && (
            <p
              title={t("auth.returnToTitle", { page: t(returnToKey) })}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-2.5 py-1 text-[11px] text-ink-muted"
            >
              <ArrowLeftIcon className="h-3 w-3 shrink-0" aria-hidden />
              {t("auth.returnTo")}
              <span className="text-ink">{t(returnToKey)}</span>
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-[--radius-md] border border-danger-border bg-danger-soft px-3 py-2 text-[--text-sm] text-danger"
            >
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-4">{children}</div>
        </div>

        {footer && (
          <p className="mt-4 text-[--text-sm] text-ink-muted">{footer}</p>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-center gap-3 px-4 pb-5">
        <button
          type="button"
          onClick={toggle}
          className="a-btn a-btn-ghost !py-1 text-[11px]"
        >
          {theme === "dark" ? (
            <SunIcon className="h-3.5 w-3.5" />
          ) : (
            <MoonIcon className="h-3.5 w-3.5" />
          )}
          {theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
        </button>
        <LangSwitcher />
      </div>
    </div>
  );
}

export function AuthField({
  id,
  label,
  optional,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  optional?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="a-label">
        {label}
        {input.required ? null : (
          <span className="ml-1 font-normal text-ink-subtle">
            {optional ?? ""}
          </span>
        )}
      </label>
      <input id={id} className="a-input" {...input} />
    </div>
  );
}

export function AuthSubmit({
  pending,
  children,
  pendingLabel,
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel: string;
}) {
  return (
    <button type="submit" disabled={pending} className="a-btn a-btn-primary w-full">
      {pending && <Spinner className="h-3.5 w-3.5" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
