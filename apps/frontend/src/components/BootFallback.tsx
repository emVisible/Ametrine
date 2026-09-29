// src/components/BootFallback.tsx
// 根级兜底界面。放在 Provider 之下才能用 t()。
// 单独成文件：main.tsx 是入口、没有任何导出，把组件写进去会让 react-refresh 失效。
import { useI18n } from "../i18n/context";

export default function BootFallback() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="a-card max-w-md p-5 text-center">
        <h1 className="text-[--text-lg] font-semibold text-ink">
          {t("app.bootFailedTitle")}
        </h1>
        <p className="mt-1.5 text-[--text-sm] leading-relaxed text-ink-muted">
          {t("app.bootFailedDesc")}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="a-btn a-btn-primary mt-4"
        >
          {t("app.reload")}
        </button>
      </div>
    </div>
  );
}
