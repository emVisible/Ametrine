// src/components/AuthScreen.tsx
// 登录与注册共用同一套版式：品牌标识、标语、主题切换、卡片容器。
import type { ReactNode } from "react";
import { useEffect } from "react";
import brandIcon from "../assets/icon.png";
import { useTheme } from "../hooks/useTheme";
import { applyDocumentTitle } from "../utils/pageTitles";
import { MoonIcon, Spinner, SunIcon, WarningIcon } from "./icons";

export function AuthScreen({
  title,
  subtitle,
  children,
  footer,
  error,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  error?: string | null;
}) {
  const { theme, toggle } = useTheme();

  useEffect(() => {
    applyDocumentTitle(title);
  }, [title]);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-7 flex items-center gap-2.5">
          <img src={brandIcon} alt="" className="h-7 w-7" />
          <span className="text-[--text-xl] font-semibold tracking-[-0.015em] text-ink">
            Ametrine
          </span>
        </div>

        <div className="a-card w-full max-w-[22rem] px-5 py-5 shadow-card">
          <h1 className="text-[--text-lg] font-semibold text-ink">{title}</h1>
          <p className="mt-0.5 text-[--text-sm] text-ink-muted">{subtitle}</p>

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

      <div className="px-4 pb-5 text-center">
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
          {theme === "dark" ? "浅色主题" : "深色主题"}
        </button>
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
            {optional ?? "选填"}
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
