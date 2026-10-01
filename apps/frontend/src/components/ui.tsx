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
import { intlLocale } from "../i18n";
import { createPortal } from "react-dom";
import {
  ConfirmContext,
  type ConfirmOptions,
} from "../hooks/useConfirm";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useRovingTabs } from "../hooks/useRovingTabs";
import { useI18n } from "../i18n/context";
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
  const { t } = useI18n();
  return (
    <nav aria-label={t("ui.breadcrumb")} className="mb-2 flex items-center gap-1 text-[11px]">
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

/* ───────────────────────── 折叠行 ───────────────────────── */

/**
 * 管理台唯一的「在行内展开」容器。
 *
 * 之前同一个问题有两种容器：租户的成员开弹窗、成员的行开带页签的弹窗、
 * 而租户列表自己又是一张表 —— 视觉上就是两块硬拼的东西。收敛成这一个：
 * 头行给摘要与计数，展开带给该行的全部内容，箭头方向即状态。
 *
 * open 由调用方持有：搜索命中要自动展开、跨行状态要能记住，
 * 组件自己藏状态的话这两件事都做不到。
 */
export function Disclosure({
  open,
  onToggle,
  title,
  meta,
  actions,
  children,
  overlay,
  level = 0,
}: {
  open: boolean;
  onToggle: () => void;
  title: ReactNode;
  /** 头行右侧的摘要区：计数、标签、状态徽章 */
  meta?: ReactNode;
  /** 头行最右的常驻操作（不被折叠吞掉的那几个） */
  actions?: ReactNode;
  children: ReactNode;
  /**
   * **常驻操作要打开的弹层，放这里，不要放 children。**
   *
   * children 在折叠时整体不渲染（这是刻意的：收起的库不该去拉集合与文档）。
   * 于是把 `<Modal>` 写在 children 里会出现一种必然失效的组合：
   * 触发它的按钮在 `actions` 槽（常驻、看得见、点得动），而它要打开的弹层在被卸载的子树里。
   * 用户看到的就是「按钮点了没任何反应」—— `/admin/vector` 的「新建集合」在折叠行上就是这样，
   * 由一次浏览器实测抓到（展开的行能开、折叠的行不能开）。
   * 光把那一处挪走只修了一个实例；这个槽的存在才是让同类写法写不出来的地方。
   */
  overlay?: ReactNode;
  /** 嵌套层级：子级用 1，靠缩进而不是再画一个边框来表明归属 */
  level?: 0 | 1;
}) {
  const { t } = useI18n();
  const panelId = useId();

  return (
    <div
      className={
        level === 0
          ? "a-card overflow-hidden"
          : "rounded-md border border-line-subtle bg-surface-sunken/40"
      }
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          // 收起时那块面板根本不在 DOM 里（这是刻意的：收起的库不该去拉集合与文档）。
          // 还指着它的 id 就等于给读屏一个不存在的关系 —— 只在真的挂着时指。
          aria-controls={open ? panelId : undefined}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronRightIcon
            className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-ui ${
              open ? "rotate-90" : ""
            }`}
          />
          <span className="sr-only">
            {open ? t("ui.collapse") : t("ui.expand")}
          </span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {meta && (
            <span className="flex shrink-0 items-center gap-2">{meta}</span>
          )}
        </button>
        {actions && (
          <span className="flex shrink-0 items-center gap-1.5">{actions}</span>
        )}
      </div>

      {open && (
        <div
          id={panelId}
          role="group"
          className="border-t border-line-subtle px-3 py-2.5"
        >
          {children}
        </div>
      )}

      {/* 在 `{open && …}` 守卫**之外**、外层常驻 div **之内**：
          折叠时这里依然挂载，弹层（自带 portal 到 body）才可能被打开。 */}
      {overlay}
    </div>
  );
}

/* ───────────────────────── 状态反馈 ───────────────────────── */

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-12 text-[--text-sm] text-ink-subtle"
    >
      <Spinner className="h-4 w-4" aria-hidden />
      {label ?? t("common.loading")}
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
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-danger-border bg-danger-soft text-danger">
        <WarningIcon className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="text-[--text-sm] font-medium text-ink">
          {title ?? t("errors.requestFailed")}
        </p>
        <p className="mt-0.5 text-[--text-sm] text-ink-muted">
          {error instanceof Error ? error.message : t("errors.unknown")}
        </p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="a-btn a-btn-outline !py-1">
          <RefreshIcon className="h-3.5 w-3.5" />
          {t("common.retry")}
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
  const { t } = useI18n();
  const data = rows ?? [];
  if (error && !loading) return <ErrorState error={error} onRetry={onRetry} />;
  if (!loading && !data.length)
    return <>{empty ?? <EmptyState title={t("ui.noData")} />}</>;

  return (
    <table className="a-table" aria-busy={loading || undefined}>
      {loading && <caption className="sr-only">{t("ui.loadingData")}</caption>}
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
  error,
  optional,
  required,
  className,
  id: idProp,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  /**
   * 字段自己的拒绝理由。有它时 `hint` 不再显示 —— 同一行既解释「可选」又宣布「不合法」，
   * 等于两个声音讲一件事；而且 `aria-invalid` 必须和屏幕上那句话是同一件事，
   * 读屏才不会在「这里错了」之后又念一句无关的说明。
   */
  error?: string;
  optional?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const body = (
    <input
      id={id}
      className={className ? `a-input ${className}` : "a-input"}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={label && note ? noteId : undefined}
      {...rest}
    />
  );
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
      {note && (
        <p
          id={noteId}
          className={`mt-1 text-[11px] ${error ? "text-danger" : "text-ink-subtle"}`}
        >
          {note}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  id: idProp,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  /** 同 TextInput：拒绝理由优先于提示，且与 `aria-invalid` 同源。 */
  error?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const body = (
    <textarea
      id={id}
      className={className ? `a-input ${className}` : "a-input"}
      aria-invalid={error ? true : undefined}
      aria-describedby={note ? noteId : undefined}
      {...rest}
    />
  );
  if (!label)
    return note ? (
      <>
        {body}
        <p id={noteId} className={`mt-1 text-[11px] ${error ? "text-danger" : "text-ink-subtle"}`}>
          {note}
        </p>
      </>
    ) : (
      body
    );
  return (
    <div>
      <label htmlFor={id} className="a-label">
        {label}
      </label>
      {body}
      {note && (
        <p id={noteId} className={`mt-1 text-[11px] ${error ? "text-danger" : "text-ink-subtle"}`}>
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * 表单里的下拉。
 *
 * 它以前是原生 `<select>`：面板由浏览器绘制（深色主题下整块白底 + 系统蓝高亮），
 * 和同一页里自制的 listbox 长成两个世界。现在全站只有一个实现：
 * Picker 负责 listbox 本体，Select 只负责「字段标签 + 提示 + 整宽」这层表单语义。
 * 需要「无/全部」这类可选项时，请把它写成显式 option：自绘 listbox 的
 * placeholder 只是占位提示，不能像原生 `<option value="">` 那样被选中。
 */
export function Select({
  label,
  hint,
  options,
  placeholder,
  id: idProp,
  className,
  panelClassName,
  value,
  onChange,
  disabled,
  ...aria
}: {
  label?: string;
  hint?: string;
  options: { value: string | number; label: string }[];
  placeholder?: string;
  id?: string;
  className?: string;
  panelClassName?: string;
  value: string | number | null;
  onChange: (v: string | number) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const ariaLabel = aria["aria-label"];
  const body = (
    <Picker
      id={id}
      label={label ?? ariaLabel ?? placeholder ?? ""}
      value={value}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      panelClassName={panelClassName}
      onChange={onChange}
    />
  );
  if (!label) return body;
  return (
    <div className="min-w-0">
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
/** 下拉面板的定位尺寸（fixed，挂到 body 上，见 Picker 的注释）。 */
interface PanelPos {
  left: number;
  minWidth: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}
const PANEL_MAX_H = 224; // 与原来的 max-h-56 一致
const EDGE = 8; // 距视口边缘的最小留白
const FLIP_MIN = 120; // 下方少于此高度且上方更宽裕时，面板朝上开

export function Picker<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className = "",
  panelClassName = "w-56",
  id,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  panelClassName?: string;
  /** 给 <label htmlFor> 用 */
  id?: string;
}) {
  const { t } = useI18n();
  const fallbackPlaceholder = placeholder ?? t("ui.pick");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  /**
   * 面板挂到 body 上，而不是摆在触发器旁边。
   *
   * 起因是实测到的：`Panel` 是 `.a-card overflow-hidden`（圆角不被表格行背景戳破），
   * 于是它内部任何 `absolute` 的下拉都会被卡片底边裁掉 —— 用户看到的就是
   * 「类型下拉只露出第一项，其余不见了」。裁切来自祖先，
   * 给某一张卡片单独去掉 overflow-hidden 只能修好那一处，
   * 下一张卡片里再加一个下拉就复发。所以修机制，不修调用点。
   */
  const place = useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = panel.current?.offsetWidth || r.width;
    const below = window.innerHeight - r.bottom - EDGE;
    const above = r.top - EDGE;
    // 下面放不下、上面放得下才翻转：两处都放不下时留在下面（面板自己能滚）
    const flip = below < FLIP_MIN && above > below;
    const maxH = Math.floor(Math.min(PANEL_MAX_H, Math.max(below, above, 120)));
    setPos({
      left: Math.max(EDGE, Math.min(r.left, Math.max(EDGE, window.innerWidth - w - EDGE))),
      minWidth: r.width,
      top: flip ? undefined : r.bottom + 4,
      bottom: flip ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: maxH,
    });
  }, []);

  // 高亮初始值在「打开」这个动作里算，而不是放在 effect 里同步 state。
  // 位置也在这一刻算：等 effect 再算会先画出一帧没有定位的面板。
  const openPanel = () => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i < 0 ? 0 : i);
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    place(); // 面板已挂载，用它的真实宽度再校一次水平夹取
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // 面板现在挂在 body 上，不在 root 里：不把 panel 算作「里面」，
      // mousedown 会先把它卸载，选项的 click 就永远打不到 ——
      // 表现是「下拉能打开，但点不动任何一项」。
      if (root.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  const commit = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
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
        id={id}
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`flex w-full items-center gap-1.5 rounded-[--radius-md] border border-line bg-surface-sunken px-3 py-1.5 text-left text-[--text-sm] transition-ui ${
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
          {selected?.label ?? fallbackPlaceholder}
        </span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 text-ink-subtle transition-ui ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <ul
            ref={panel}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              bottom: pos.bottom,
              minWidth: pos.minWidth,
              maxHeight: pos.maxHeight,
            }}
            className={`a-card anim-pop z-50 overflow-y-auto py-1 shadow-pop ${panelClassName}`}
          >
            {options.length === 0 ? (
              <li className="px-3 py-2 text-[11px] text-ink-subtle">
                {t("ui.noOptions")}
              </li>
            ) : (
              options.map((o, i) => (
                <li key={o.value} role="option" aria-selected={o.value === value}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => commit(i)}
                    className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-ui ${
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
          </ul>,
          document.body,
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
  placeholder,
  className = "",
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const label = placeholder ?? t("common.search");
  return (
    <div className={`relative ${className}`}>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
      <input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="a-input pl-8"
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  /** 提交中要挡的是**这一行**的开关，而不是整列（调用点负责只挡自己那个） */
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "cursor-wait" : "cursor-pointer"}`}>
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
        aria-label={label}
      />
      <span className="relative h-[18px] w-8 rounded-full bg-line-strong transition-colors after:absolute after:top-[2px] after:left-[2px] after:h-[14px] after:w-[14px] after:rounded-full after:bg-surface after:shadow-card after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-[14px] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--c-focus)] peer-disabled:opacity-50" />
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
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useDialogFocus(ref);

  // onClose 几乎都是调用方现写的箭头函数，每次父组件渲染都是新身份。
  // 把它放进 effect 依赖里，就等于「父组件每渲染一次就重跑一次这个 effect」——
  // 于是表单每敲一个字，下面那句 focus 就把光标从输入框抢走一次，
  // 表现成「一输入弹层就 deactive、光标丢失」。这里用 ref 持有最新回调，effect 只在挂载时跑。
  const closeRef = useRef(onClose);
  // 在 effect 里同步而不是渲染期赋值：渲染期写 ref 本身就被 rules-of-hooks 拦下。
  // 不带依赖数组 = 每次渲染后都刷新，Escape 与关闭按钮拿到的永远是最新回调。
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 初始焦点：优先第一个「可输入的控件」而不是第一个可聚焦元素。
  // 原来选的是 input,textarea,select,button，而文档顺序里第一个是头部的关闭按钮，
  // 于是带表单的弹层打开后焦点落在 X 上，Tab 与回车语义都不对。
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const field = node.querySelector<HTMLElement>(
      "input:not([type=hidden]),textarea,select,[contenteditable=true]",
    );
    (field ?? node.querySelector<HTMLElement>("button"))?.focus();
  }, []);

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
            aria-label={t("common.close")}
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
  const { t } = useI18n();
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
              {state?.cancelLabel ?? t("common.cancel")}
            </button>
            <button
              type="button"
              className={`a-btn ${state?.tone === "accent" ? "a-btn-primary" : "a-btn-danger"}`}
              onClick={() => close(true)}
            >
              {state?.confirmLabel ?? t("ui.confirmDelete")}
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
  const { t } = useI18n();
  const { page, pages, total } = paged;
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("ui.pagination")} className="flex items-center justify-between gap-3">
      <p role="status" className="text-[11px] text-ink-subtle tnum">
        {t("ui.pageSummary", { total: total.toLocaleString(intlLocale()), page, pages })}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="a-btn a-btn-outline !py-1 text-[11px]"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t("ui.prevPage")}
        </button>
        <button
          type="button"
          className="a-btn a-btn-outline !py-1 text-[11px]"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          {t("ui.nextPage")}
        </button>
      </div>
    </nav>
  );
}
