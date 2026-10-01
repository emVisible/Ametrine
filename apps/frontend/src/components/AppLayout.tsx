// src/components/AppLayout.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import brandIcon from "../assets/icon.png";
import useAuthStore from "../stores/useAuthStore";
import useSessionStore, { type Session } from "../stores/sessionStore";
import useStreamStore from "../stores/streamStore";
import { useCurrentUser } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { useRovingTabs } from "../hooks/useRovingTabs";
import { useI18n } from "../i18n/context";
import { LangSwitcher } from "../i18n/I18nProvider";
import type { MsgKey } from "../i18n";
import { applyDocumentTitle, pageTitleForPath } from "../utils/pageTitles";
import { pageLoaders, preloadRoute } from "../pageLoaders";
import CommandPalette from "./CommandPalette";
import {
  ChatIcon,
  ChevronDownIcon,
  CloseIcon,
  GaugeIcon,
  LayersIcon,
  LibraryIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  WarningIcon,
  SunIcon,
  UserIcon,
} from "./icons";

const APP_VERSION = "0.1.0";
type Mode = "llm" | "rag";
const MODE_ROUTE: Record<Mode, string> = { llm: "chat", rag: "rag" };

interface NavEntry {
  to: string;
  /** 存文案键而不是文案：切语言时不必重建这张表 */
  labelKey: MsgKey;
  Icon: typeof ChatIcon;
  adminOnly?: boolean;
  /** NavLink 默认对后代路径也判 active，叶子路由必须 end，否则 /admin 会在 /admin/xxx 上同时高亮 */
  exact?: boolean;
}

const NAV: NavEntry[] = [
  { to: "/dashboard", labelKey: "page.dashboard", Icon: GaugeIcon, exact: true },
  { to: "/admin/vector", labelKey: "page.vector", Icon: LibraryIcon },
  // 回答质量队列是管理员的日常入口：先看哪些回答不值得信，再回知识库修它
  { to: "/admin/queue", labelKey: "page.queue", Icon: WarningIcon, exact: true, adminOnly: true },
  // 模型推理排在知识库之后：它决定「答得好不好」的上限，但不是每天都进的地方
  {
    to: "/admin/inference",
    labelKey: "page.inference",
    Icon: LayersIcon,
    exact: true,
    adminOnly: true,
  },
  { to: "/admin/access", labelKey: "page.access", Icon: ShieldIcon, exact: true, adminOnly: true },
  { to: "/settings", labelKey: "page.settings", Icon: SettingsIcon, exact: true },
];

const BUCKETS = ["today", "yesterday", "week", "month", "earlier"] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketOf(iso: string): Bucket {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const days = Math.floor(
    (+startOfToday -
      +new Date(d.getFullYear(), d.getMonth(), d.getDate())) /
      86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  if (days < 30) return "month";
  return "earlier";
}

function ActiveBar({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-y-1 left-0 w-[2px] rounded-r-full bg-accent"
    />
  );
}

function SessionRow({
  session,
  active,
  renaming,
  leaving,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  session: Session;
  active: boolean;
  renaming: boolean;
  leaving: boolean;
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const streaming = useStreamStore((s) => s.active[session.id] === true);

  // 进入重命名时自动全选：用回调 ref 在挂载那一刻处理，不需要 effect 同步 state
  const selectOnMount = (el: HTMLInputElement | null) => {
    if (el) el.select();
  };

  if (renaming) {
    return (
      <li className="px-2 py-0.5">
        {/* 输入框只在重命名期间挂载，用 defaultValue 取初值即可，
            不需要 effect 把 title 同步进 state */}
        <input
          ref={selectOnMount}
          defaultValue={session.title}
          onBlur={(e) =>
            onCommitRename(e.target.value.trim() || session.title)
          }
          onKeyDown={(e) => {
            const value = e.currentTarget.value.trim();
            if (e.key === "Enter") onCommitRename(value || session.title);
            if (e.key === "Escape") onCancelRename();
          }}
          autoFocus
          aria-label={t("nav.renameSession")}
          className="a-input !py-1 text-[11px]"
        />
      </li>
    );
  }

  const title = session.title || t("session.newTitle");
  return (
    <li
      className={`group relative overflow-hidden transition-[max-height,opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-in-out)] ${
        leaving ? "max-h-0 -translate-x-1 opacity-0" : "max-h-16"
      } ${active ? "bg-accent-soft" : "hover:bg-surface-hover"}`}
      onDoubleClick={onStartRename}
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative w-full cursor-default py-1.5 pl-10 pr-8 text-left"
      >
        <ActiveBar show={active} />
        <span
          className={`block truncate text-[--text-sm] ${
            active ? "font-medium text-accent-ink" : "text-ink"
          }`}
        >
          {title}
        </span>
        {/* 生成中的会话要能在大老远就被认出来：否则切走了就不知道它还在跑 */}
        {streaming ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-accent-ink">
            <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {t("chat.streaming")}
          </span>
        ) : (
          <span className="mt-0.5 block text-[11px] text-ink-subtle tnum">
            {t("nav.messageCount", { n: session.messages.length })}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("nav.deleteSession", { title })}
        title={t("common.del")}
        className="absolute right-1.5 top-1.5 rounded-[--radius-sm] p-1 text-ink-subtle opacity-0 transition-ui hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function ConversationZone({
  mode,
  onNavigate,
}: {
  mode: Mode;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const renameSession = useSessionStore((s) => s.renameSession);

  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [leavingIds, setLeavingIds] = useState<string[]>([]);

  // 只负责删；URL 与 store 的重新对齐交给 useSessionMessages 单点处理，
  // 这里再 navigate 会和它抢路由，把幽灵 convId 又写回去
  const commitDelete = useCallback(
    (ids: string[]) => {
      setLeavingIds((prev) => prev.filter((x) => !ids.includes(x)));
      ids.forEach((id) => deleteSession(id));
    },
    [deleteSession],
  );

  // 收起动画结束后才真正移除；计时器挂在 effect 上，卸载时自动清理
  useEffect(() => {
    if (leavingIds.length === 0) return;
    const timer = window.setTimeout(() => commitDelete(leavingIds), 190);
    return () => clearTimeout(timer);
  }, [leavingIds, commitDelete]);

  // 分组键用 bucket 标识符，文案留到渲染时再取：切语言不需要重算分组
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = sessions
      .filter((s) => s.mode === mode)
      .filter((s) => !needle || s.title.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

    const map = new Map<Bucket, Session[]>();
    for (const s of list) {
      const key = bucketOf(s.updatedAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return BUCKETS.filter((k) => map.has(k)).map((k) => ({
      bucket: k,
      items: map.get(k)!,
    }));
  }, [sessions, mode, query]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const open = (id: string) => {
    useSessionStore.getState().switchSession(id);
    navigate(`/${MODE_ROUTE[mode]}/${id}`);
    onNavigate?.();
  };

  const remove = (id: string) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      commitDelete([id]);
      return;
    }
    setLeavingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const tabsRef = useRef<HTMLDivElement>(null);
  const switchMode = (m: Mode) => {
    const first = sessions
      .filter((s) => s.mode === m)
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
    if (first) {
      useSessionStore.getState().switchSession(first.id);
      navigate(`/${MODE_ROUTE[m]}/${first.id}`);
    } else {
      navigate(`/${MODE_ROUTE[m]}`);
    }
    onNavigate?.();
  };
  const onTabsKeyDown = useRovingTabs(tabsRef, {
    index: mode === "rag" ? 1 : 0,
    onSelect: (i) => switchMode(i === 1 ? "rag" : "llm"),
  });

  const newLabel = mode === "rag" ? t("nav.newRag") : t("nav.newChat");

  return (
    <section className="flex min-h-0 flex-1 flex-col pt-2">
      {/* 分隔线内缩而不是通栏：通栏那道线会被读成「另一块面板的顶边」，
          整条侧栏就变成两段硬拼在一起 */}
      <div className="mx-2 border-t border-line-subtle" />
      {/* 模式切换本身就是这一区的标题。以前上面另起一行写「对话」、下面 tab 又叫「对话」，
          同一个词两种含义贴在一起，而「新建」孤悬在右边 —— 现在 tab 与 + 同一行同一基线 */}
      <div className="flex items-center gap-1 px-2 py-2">
        <div
          ref={tabsRef}
          role="tablist"
          aria-label={t("nav.modeLabel")}
          onKeyDown={onTabsKeyDown}
          className="flex min-w-0 flex-1 rounded-[--radius-md] bg-surface-sunken p-0.5"
        >
          {(
            [
              ["llm", t("nav.modeChat"), ChatIcon],
              ["rag", t("nav.modeRag"), SearchIcon],
            ] as const
          ).map(([m, label, Icon]) => {
            const selected = mode === m;
            return (
              <button
                key={m}
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                type="button"
                onClick={() => switchMode(m)}
                className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-[--radius-sm] py-1 text-[12px] transition-ui ${
                  selected
                    ? "bg-surface font-medium text-ink shadow-card"
                    : "text-ink-subtle hover:text-ink-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() =>
            createSession(mode).then((id) => {
              navigate(`/${MODE_ROUTE[mode]}/${id}`, { replace: true });
              onNavigate?.();
            })
          }
          aria-label={newLabel}
          title={newLabel}
          className="a-btn a-btn-ghost shrink-0 !px-1.5 !py-1"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="px-2 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("nav.searchSessions")}
            aria-label={t("nav.searchSessions")}
            className="a-input !py-1 pl-8 text-[11px]"
          />
        </div>
      </div>

      <nav aria-label={t("nav.sessionHistory")} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {total === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] leading-relaxed text-ink-subtle">
            {query ? t("nav.noMatch") : t("nav.noSessions")}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.bucket} className="mb-0.5">
              <h3 className="a-section-title pb-1 pt-2 pl-10 pr-3 opacity-70">
                {t(`nav.buckets.${g.bucket}`)}
              </h3>
              <ul className="anim-stagger">
                {g.items.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={currentSessionId === s.id}
                    renaming={renamingId === s.id}
                    leaving={leavingIds.includes(s.id)}
                    onOpen={() => open(s.id)}
                    onStartRename={() => setRenamingId(s.id)}
                    onCommitRename={(title) => {
                      renameSession(s.id, title);
                      setRenamingId(null);
                    }}
                    onCancelRename={() => setRenamingId(null)}
                    onDelete={() => remove(s.id)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
    </section>
  );
}

function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t } = useI18n();
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-[--radius-md] px-2 py-1.5 text-left transition-ui hover:bg-surface-hover"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink">
          {name?.charAt(0)?.toUpperCase() || "U"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[--text-sm] text-ink">
          {name}
        </span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-ui ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="a-card anim-pop absolute bottom-full left-0 z-20 mb-1.5 w-52 overflow-hidden py-1 shadow-pop"
        >
          <div className="border-b border-line-subtle px-3 py-2">
            <p className="truncate text-[--text-sm] font-medium text-ink">{name}</p>
            <p className="truncate text-[11px] text-ink-subtle">{email || t("nav.noEmail")}</p>
          </div>
          <button
            role="menuitem"
            onClick={() => go("/profile")}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[--text-sm] text-ink-muted transition-ui hover:bg-surface-hover hover:text-ink"
          >
            <UserIcon className="h-4 w-4" />
            {t("nav.profile")}
          </button>
          <button
            role="menuitem"
            onClick={() => go("/settings")}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[--text-sm] text-ink-muted transition-ui hover:bg-surface-hover hover:text-ink"
          >
            <SettingsIcon className="h-4 w-4" />
            {t("page.settings")}
          </button>
          <div className="my-1 border-t border-line-subtle" />
          <button
            role="menuitem"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[--text-sm] text-danger transition-ui hover:bg-danger-soft"
          >
            <LogoutIcon className="h-4 w-4" />
            {t("nav.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarBody({
  isAdmin,
  mode,
  userName,
  userEmail,
  onNavigate,
  onOpenPalette,
}: {
  isAdmin: boolean;
  mode: Mode;
  userName: string;
  userEmail: string;
  onNavigate?: () => void;
  onOpenPalette?: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-3.5">
        <img src={brandIcon} alt="" className="h-5 w-5" />
        <span className="flex-1 text-[--text-base] font-semibold tracking-[-0.015em] text-ink">
          {t("app.name")}
        </span>
        {onOpenPalette && (
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label={t("nav.searchJump")}
            title={t("nav.searchJumpKeys")}
            className="a-btn a-btn-ghost !px-1.5 !py-1"
          >
            <SearchIcon className="h-3.5 w-3.5" />
            <kbd className="text-[10px] text-ink-subtle">K</kbd>
          </button>
        )}
        <span className="text-[10px] text-ink-subtle tnum">v{APP_VERSION}</span>
      </div>

      <nav aria-label={t("nav.main")} className="shrink-0 space-y-px px-2 py-2">
        {NAV.filter((e) => !e.adminOnly || isAdmin).map(({ to, labelKey, Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={onNavigate}
            className={({ isActive }) =>
              `relative flex items-center gap-2 rounded-[--radius-md] px-2 py-1.5 text-[--text-sm] transition-ui ${
                isActive
                  ? "bg-accent-soft font-medium text-accent-ink"
                  : "text-ink-muted hover:bg-surface-hover hover:text-ink"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <ActiveBar show={isActive} />
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <ConversationZone mode={mode} onNavigate={onNavigate} />

      <div className="flex shrink-0 items-center gap-1 border-t border-line-subtle p-2">
        <UserMenu name={userName} email={userEmail} />
        {/* 语言切换在登录页之外也必须有：登录后才是日常使用的界面 */}
        <LangSwitcher compact />
        <ThemeButton />
      </div>
    </>
  );
}

function ThemeButton() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t(dark ? "theme.switchToLight" : "theme.switchToDark")}
      title={t(dark ? "theme.toLight" : "theme.toDark")}
      className="a-btn a-btn-ghost shrink-0 !px-1.5"
    >
      {dark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}

export default function AppLayout() {
  const { data: user } = useCurrentUser();
  const { toggle } = useTheme();
  const { t } = useI18n();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const activeMode: Mode = location.pathname.startsWith("/rag") ? "rag" : "llm";
  const routeRoot = `/${location.pathname.split("/")[1] ?? ""}`;
  const isAdmin = !!user?.permissions?.includes("admin");
  const userName = user?.name ?? t("nav.signedOut");
  const userEmail = user?.email ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // t 随语言变化，所以切语言时标题立刻跟上（不等下一次跳转）
  useEffect(() => {
    const key = pageTitleForPath(location.pathname);
    applyDocumentTitle(key ? t(key) : null);
  }, [location.pathname, t]);

  // 首帧之后把所有路由分片预取一遍：动态 import 按 specifier 缓存，
  // 取过一次的页面再跳转就是同步命中，不会再出现「内容区空一帧」。
  // 用 import() 而不是写死的 <link rel=modulepreload>，分片哈希变了也不用重新构建 HTML。
  useEffect(() => {
    const run = () => {
      for (const load of pageLoaders) preloadRoute(load).catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(run, 1200);
    return () => clearTimeout(timer);
  }, []);

  // 换页回到顶部。以前是靠 <main key=...> 重建节点顺带做到的，
  // 但重建会让整块正文从 opacity:0 重新入场 —— 那就是跳转时的白屏。
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div id="app-shell" className="flex h-screen overflow-hidden bg-canvas">
      {/* 键盘用户不必穿过整条侧栏（导航 + 全部会话行）才能碰到正文 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[--radius-md] focus:bg-surface focus:px-3 focus:py-2 focus:text-[--text-sm] focus:font-medium focus:text-ink focus:shadow-pop"
      >
        {t("app.skipToMain")}
      </a>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <SidebarBody
          isAdmin={isAdmin}
          mode={activeMode}
          userName={userName}
          userEmail={userEmail}
          onOpenPalette={() => setPaletteOpen(true)}
        />
      </aside>

      {drawerOpen && (
        <>
          <div
            className="anim-fade fixed inset-0 z-30 bg-[var(--overlay)] md:hidden"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-surface shadow-modal md:hidden">
            <SidebarBody
              isAdmin={isAdmin}
              mode={activeMode}
              userName={userName}
              userEmail={userEmail}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("nav.openNav")}
            className="a-btn a-btn-ghost !px-1.5"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <img src={brandIcon} alt="" className="h-4 w-4" />
          <span className="flex-1 text-[--text-sm] font-semibold text-ink">{t("app.name")}</span>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t("nav.searchJump")}
            className="a-btn a-btn-ghost !px-1.5"
          >
            <SearchIcon className="h-3.5 w-3.5" />
          </button>
          <LangSwitcher compact />
          <ThemeButton />
        </header>

        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto bg-canvas outline-none"
        >
          {/* 动画挂在内容上而不是滚动容器上：容器节点保持稳定，换页时正文
              从 35% 不透明度起步，最差也是「略淡的上一页」而不是空白一片。
              分段用路由根（/chat、/rag、/admin…）而不是完整 pathname：
              首次发送会把 /chat 改写成 /chat/<新会话 id>，那是同一个页面，
              不能在这里重建 —— 重建会连正在流式输出的消息一起丢掉。 */}
          <div key={routeRoot} className="anim-route h-full">
            <Outlet />
          </div>
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          isAdmin={isAdmin}
          onToggleTheme={toggle}
        />
      )}
    </div>
  );
}
