// src/components/Toast.tsx
import { useCallback, useEffect, useState } from "react";
import { ToastContext, type ToastType } from "../hooks/useToast";
import { CheckIcon, CloseIcon, InfoIcon, WarningIcon } from "./icons";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let toastId = 0;
const MAX_VISIBLE = 3;

const VISUAL: Record<
  ToastType,
  { ring: string; Icon: typeof CheckIcon; iconClass: string }
> = {
  success: {
    ring: "border-success-border",
    Icon: CheckIcon,
    iconClass: "border-success-border bg-success-soft text-success",
  },
  error: {
    ring: "border-danger-border",
    Icon: WarningIcon,
    iconClass: "border-danger-border bg-danger-soft text-danger",
  },
  warning: {
    ring: "border-warning-border",
    Icon: WarningIcon,
    iconClass: "border-warning-border bg-warning-soft text-warning",
  },
  info: {
    ring: "border-line",
    Icon: InfoIcon,
    iconClass: "border-line bg-surface-sunken text-ink-muted",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }].slice(-MAX_VISIBLE));
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast: t,
  onRemove,
}: {
  toast: Toast;
  onRemove: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onRemove, 4000);
    return () => clearTimeout(timer);
  }, [onRemove]);

  const visual = VISUAL[t.type];

  return (
    <div
      className={`a-card anim-toast pointer-events-auto flex items-start gap-2.5 border px-3 py-2.5 shadow-pop ${visual.ring}`}
    >
      <span
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${visual.iconClass}`}
      >
        <visual.Icon className="h-3 w-3" />
      </span>
      <p className="min-w-0 flex-1 text-[--text-sm] leading-relaxed text-ink">
        {t.message}
      </p>
      <button
        type="button"
        onClick={onRemove}
        aria-label="关闭提示"
        className="shrink-0 rounded-[--radius-sm] p-0.5 text-ink-subtle transition-ui hover:bg-surface-sunken hover:text-ink"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
