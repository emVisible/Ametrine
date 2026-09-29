// src/components/ErrorBoundary.tsx
// 类组件里不能用 useI18n，这里取模块级 t()：语言由 Provider 同步到模块，
// 兜底界面本身已经在异常路径上，不值得为它再建一个订阅。
import { Component, type ReactNode } from "react";
import { t } from "../i18n";
import { RefreshIcon, WarningIcon } from "./icons";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[24rem] items-center justify-center p-8">
          <div className="a-card max-w-md p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-danger-border bg-danger-soft text-danger">
                <WarningIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[--text-base] font-semibold text-ink">
                  {t("app.pageRenderFailed")}
                </h2>
                <p className="mt-1 text-[--text-sm] leading-relaxed text-ink-muted">
                  {this.state.error?.message || t("app.unexpectedError")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end border-t border-line-subtle pt-3">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="a-btn a-btn-outline !py-1"
              >
                <RefreshIcon className="h-3.5 w-3.5" />
                {t("common.retry")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
