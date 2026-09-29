// src/components/ui.tsx
// 后台共用语义组件。此前 Admin / AdminTenant / AdminVector / Profile / Settings
// 各自重复实现页头、表格、加载态、空态、内联表单与删除确认，
// 且用 message.includes("成功") 这类字符串嗅探来判断结果。统一收敛到这里。
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ConfirmContext,
  type ConfirmOptions,
} from "../hooks/useConfirm";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useRovingTabs } from "../hooks/useRovingTabs";
import type { Page } from "../utils/pagination";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  RefreshIcon,
  SearchIcon,
  Spinner,
  WarningIcon,
} from "./icons";

/* ───────────────────────── 页面骨架 ───────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {breadcrumb}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[--text-2xl] font-semibold text-ink">{title}</h1>
          {description && (
            <p className="mt-1 text-[--text-sm] text-ink-muted">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; to?: string }[];
}) {
  return (
    <nav aria-label="面包屑" className="mb-2 flex items-center gap-1 text-[11px]">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRightIcon className="h-3 w-3 text-ink-subtle" />}
          {item.to ? (
            <a href={item.to} className="text-ink-muted hover:text-accent-ink hover:underline">
              {item.label}
            </a>
          ) : (
            <span className="font-medium text-ink">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  footer,
  bodyClass = "",
}: {
  title?: ReactNode;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  bodyClass?: string;
}) {
  return (
    <section className="a-card overflow-hidden">
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-3 border-b border-line-subtle bg-surface-sunken px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[--text-sm] font-medium text-ink">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-[11px] text-ink-subtle">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
      {footer && (
        <footer className="border-t border-line-subtle px-4 py-2">{footer}</footer>
      )}
    </section>
  );
}

/* ───────────────────────── 状态反馈 ───────────────────────── */

export function Loading({ label = "加载中…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-12 text-[--text-sm] text-ink-subtle"
    >
      <Spinner className="h-4 w-4" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: (p: { className?: string }) => ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center px-6 py-14 text-center"
    >
      {Icon && (
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-sunken text-ink-subtle">
          <Icon className="h-4.5 w-4.5" />
        </span>
      )}
      <h3 className="text-[--text-base] font-medium text-ink">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-[--text-sm] text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "请求失败",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-danger-border bg-danger-soft text-danger">
        <WarningIcon className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="text-[--text-sm] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[--text-sm] text-ink-muted">
          {error instanceof Error ? error.message : "未知错误"}
        </p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="a-btn a-btn-outline !py-1">
          <RefreshIcon className="h-3.5 w-3.5" />
          重试
        </button>
      )}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line bg-surface-sunken text-ink-muted",
  accent: "border-accent-border bg-accent-soft text-accent-ink",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
  danger: "border-danger-border bg-danger-soft text-danger",
};

export function StatusBadge({
  tone = "neutral",
  children,
  dot,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`a-badge ${TONE_CLASS[tone]}`} title={title}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/* ───────────────────────── 数据表 ───────────────────────── */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  width?: string;
  align?: "left" | "right" | "center";
  hideBelow?: "sm" | "md" | "lg";
}

const alignClass = (a?: string) =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

const hideClass = (b?: string) =>
  b === "sm"
    ? "hidden sm:table-cell"
    : b === "md"
      ? "hidden md:table-cell"
      : b === "lg"
        ? "hidden lg:table-cell"
        : "";

// 四行错落宽度：等宽方块看起来像故障，不像在加载
const SKELETON_WIDTHS = ["68%", "54%", "62%", "46%"];

function TableHead<T>({ columns }: { columns: Column<T>[] }) {
  return (
    <thead>
      <tr>
        {columns.map((c) => (
          <th
            key={c.key}
            scope="col"
            style={c.width ? { width: c.width } : undefined}
            className={`${alignClass(c.align)} ${hideClass(c.hideBelow)}`}
          >
            {c.header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  error,
  onRetry,
  empty,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
}) {
  const data = rows ?? [];
  if (error && !loading) return <ErrorState error={error} onRetry={onRetry} />;
  if (!loading && !data.length)
    return <>{empty ?? <EmptyState title="暂无数据" />}</>;

  return (
    <table className="a-table" aria-busy={loading || undefined}>
      {loading && <caption className="sr-only">正在加载数据…</caption>}
      <TableHead columns={columns} />
      {loading ? (
        // 加载态保留真实表头与列宽：整块换成 spinner 会让面板高度塌陷，
        // 数据到位时内容整体下跳一次
        <tbody>
          {SKELETON_WIDTHS.map((w, r) => (
            <tr key={r} aria-hidden>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${alignClass(c.align)} ${hideClass(c.hideBelow)}`}
                >
                  <span
                    className="skeleton block h-3.5"
                    style={{ width: c.align === "right" ? "2.5rem" : w }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      ) : (
        <tbody>
          {data.map((row, i) => (
            <tr
              key={rowKey(row)}
              // 行是下钻入口时，键盘必须够得着；给 <tr> 加 role=button 会毁掉表格语义，
              // 所以保留 row 语义、只补可聚焦与按键激活
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer" : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${alignClass(c.align)} ${hideClass(c.hideBelow)}`}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      )}
    </table>
  );
}

/* ───────────────────────── 表单控件 ───────────────────────── */

export function TextInput({
  label,
  hint,
  optional,
  required,
  id: idProp,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  optional?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const body = <input id={id} className="a-input" required={required} {...rest} />;
  if (!label) return body;
  return (
    <div>
      <label htmlFor={id} className="a-label">
        {label}
        {!optional ? null : (
          <span className="ml-1 font-normal text-ink-subtle">{optional}</span>
        )}
      </label>
      {body}
      {hint && <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  id: idProp,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const body = <textarea id={id} className="a-input" {...rest} />;
  if (!label) return body;
  return (
    <div>
      <label htmlFor={id} className="a-label">
        {label}
      </label>
      {body}
      {hint && <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

export function Select({
  label,
  hint,
  options,
  placeholder,
  id: idProp,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  options: { value: string | number; label: string }[];
  placeholder?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const body = (
    <select id={id} className="a-input cursor-pointer" {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (!label) return body;
  return (
    <div>
      <label htmlFor={id} className="a-label">
        {label}
      </label>
      {body}
      {hint && <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

/**
 * 紧凑下拉选择器（listbox）。
 *
 * 换掉原生 `<select>` 的原因有两个，都是实测出来的：
 *  1. 展开面板由浏览器绘制，深色主题下是一整块刺眼的白列表，盖住半个会话区；
 *  2. 触发器宽度按**最长 option** 撑开，检索范围那两个选择器会把输入工具行顶得很宽。
 * 这里把宽度交给调用方（`className`），面板用应用自己的卡片样式并限高滚动。
 */
export function Picker<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder = "请选择",
  disabled,
  className = "",
  panelClassName = "w-56",
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  // 高亮初始值在「打开」这个动作里算，而不是放在 effect 里同步 state。
  // effect 只负责点外面收起。
  const openPanel = () => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i < 0 ? 0 : i);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(active);
    }
  };

  return (
    <div ref={root} className={`relative min-w-0 ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`flex w-full items-center gap-1.5 rounded-[--radius-md] border border-line bg-surface-sunken px-2 py-1 text-left text-[11px] transition-ui ${
          disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:border-accent-border focus-visible:border-accent"
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate ${
            selected ? "text-ink" : "text-ink-subtle"
          }`}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 text-ink-subtle transition-ui ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className={`a-card anim-pop absolute bottom-full z-30 mb-1 max-h-56 overflow-y-auto py-1 shadow-pop ${panelClassName}`}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-[11px] text-ink-subtle">没有可选项</li>
          ) : (
            options.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(i)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-ui ${
                    i === active ? "bg-surface-hover text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.value === value && (
                    <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
/** 下划线式页签。Settings、组织与权限等页面共用，避免各写一份 tab 逻辑。 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { key: T; label: string; badge?: number }[];
  ariaLabel?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(0, items.findIndex((i) => i.key === value));
  const onKeyDown = useRovingTabs(listRef, {
    index: activeIndex,
    onSelect: (next) => items[next] && onChange(items[next].key),
  });

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="mb-5 flex gap-0.5 border-b border-line"
    >
      {items.map((item, i) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            aria-selected={selected}
            tabIndex={i === activeIndex ? 0 : -1}
            type="button"
            onClick={() => onChange(item.key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3.5 pb-2 pt-1 text-[--text-sm] transition-ui ${
              selected
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {item.label}
            {item.badge != null && (
              <span className="rounded-full bg-surface-sunken px-1.5 text-[10px] text-ink-subtle tnum">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 标签—值一行，用于详情类列表（个人资料、用户详情）。 */
export function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[--text-sm] text-ink-muted">{label}</span>
      <span className="text-[--text-sm] font-medium text-ink">{value}</span>
    </div>
  );
}

export function SearchInput({
  value,
  onValueChange,
  placeholder = "搜索",
  className = "",
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
      <input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="a-input pl-8"
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
        aria-label={label}
      />
      <span className="relative h-[18px] w-8 rounded-full bg-line-strong transition-colors after:absolute after:top-[2px] after:left-[2px] after:h-[14px] after:w-[14px] after:rounded-full after:bg-surface after:shadow-card after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-[14px] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--c-focus)]" />
    </label>
  );
}

/* ───────────────────────── 弹层与确认 ───────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  // 面板单独成一个组件、随 open 挂载卸载：焦点归还依赖「挂载时捕获 opener」，
  // 组件常驻而只翻 open 的话，捕获和归还都要跟 StrictMode 的双跑搏斗。
  // portal 到 body 还顺带摆脱了 main 的 overflow 与层叠上下文裁剪。
  if (!open) return null;
  return createPortal(
    <ModalPanel
      onClose={onClose}
      title={title}
      description={description}
      footer={footer}
      width={width}
    >
      {children}
    </ModalPanel>,
    document.body,
  );
}

function ModalPanel({
  onClose,
  title,
  description,
  children,
  footer,
  width,
}: {
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useDialogFocus(ref);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--overlay)] px-4 py-[8vh]"
      onClick={onClose}
    >
      <div
        ref={ref}
        className={`a-card w-full ${width} shadow-modal`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-line-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[--text-base] font-semibold text-ink">{title}</h2>
            {description && (
              <p className="mt-0.5 text-[--text-sm] text-ink-muted">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="a-btn a-btn-ghost shrink-0 !px-1.5 !py-1"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line-subtle px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<
    (ConfirmOptions & { resolve: (v: boolean) => void }) | null
  >(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  );

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ""}
        description={typeof state?.message === "string" ? state.message : undefined}
        width="max-w-sm"
        footer={
          <>
            <button type="button" className="a-btn a-btn-ghost" onClick={() => close(false)}>
              {state?.cancelLabel ?? "取消"}
            </button>
            <button
              type="button"
              className={`a-btn ${state?.tone === "accent" ? "a-btn-primary" : "a-btn-danger"}`}
              onClick={() => close(true)}
            >
              {state?.confirmLabel ?? "确认删除"}
            </button>
          </>
        }
      >
        {typeof state?.message === "string" ? null : state?.message}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/* ───────────────────────── 分页 ───────────────────────── */

// 只接受 paginate() 的产物：页码、总页数与当前切片来自同一份计算，
// 页脚不可能再显示与表格内容矛盾的页数。
export function Pagination({
  paged,
  onPageChange,
}: {
  paged: Page<unknown>;
  onPageChange: (p: number) => void;
}) {
  const { page, pages, total } = paged;
  if (pages <= 1) return null;
  return (
    <nav aria-label="分页" className="flex items-center justify-between gap-3">
      <p role="status" className="text-[11px] text-ink-subtle tnum">
        共 {total.toLocaleString("zh-CN")} 条 · 第 {page} / {pages} 页
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="a-btn a-btn-outline !py-1 text-[11px]"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="a-btn a-btn-outline !py-1 text-[11px]"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </nav>
  );
}
