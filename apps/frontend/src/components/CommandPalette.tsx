// src/components/CommandPalette.tsx
// ⌘K / Ctrl+K 全局跳转：导航、会话、常用操作共用一个入口，避免为了跳转变多层页面。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useI18n } from "../i18n/context";
import useSessionStore, { type Session } from "../stores/sessionStore";
import {
  ChatIcon,
  GaugeIcon,
  LibraryIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UserIcon,
} from "./icons";

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  Icon: typeof ChatIcon;
  run: () => void;
}

const MODE_ROUTE = { llm: "chat", rag: "rag" } as const;

export default function CommandPalette({
  onClose,
  isAdmin,
  onToggleTheme,
}: {
  onClose: () => void;
  isAdmin: boolean;
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const sessions = useSessionStore((s) => s.sessions);
  const createSession = useSessionStore((s) => s.createSession);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogFocus(panelRef);
  // 不用 autoFocus：它会在焦点协议捕获 opener 之前就把焦点移进面板，
  // 关闭后焦点就还不给侧栏那个按钮了。普通 effect 排在 layout effect 之后，顺序刚好。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    const nav: Command[] = [
      { id: "nav-dashboard", label: t("page.dashboard"), group: t("palette.groupNav"), Icon: GaugeIcon, run: go("/dashboard") },
      { id: "nav-vector", label: t("page.vector"), group: t("palette.groupNav"), Icon: LibraryIcon, run: go("/admin/vector") },
      ...(isAdmin
        ? [{ id: "nav-access", label: t("page.access"), group: t("palette.groupNav"), Icon: ShieldIcon, run: go("/admin/access") }]
        : []),
      { id: "nav-settings", label: t("page.settings"), group: t("palette.groupNav"), Icon: SettingsIcon, run: go("/settings") },
      { id: "nav-profile", label: t("page.profile"), group: t("palette.groupNav"), Icon: UserIcon, run: go("/profile") },
    ];

    const actions: Command[] = [
      {
        id: "act-chat",
        label: t("nav.newChat"),
        group: t("palette.groupActions"),
        Icon: PlusIcon,
        run: () => {
          createSession("llm").then((id) => navigate(`/chat/${id}`, { replace: true }));
          onClose();
        },
      },
      {
        id: "act-rag",
        label: t("nav.newRag"),
        group: t("palette.groupActions"),
        Icon: PlusIcon,
        run: () => {
          createSession("rag").then((id) => navigate(`/rag/${id}`, { replace: true }));
          onClose();
        },
      },
      {
        id: "act-theme",
        label: t("palette.toggleTheme"),
        group: t("palette.groupActions"),
        Icon: ChatIcon,
        run: () => {
          onToggleTheme();
          onClose();
        },
      },
    ];

    const recent = [...sessions]
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .slice(0, 8)
      .map((s: Session) => ({
        id: `session-${s.id}`,
        label: s.title || t("session.newTitle"),
        group: t("palette.groupRecent"),
        hint: s.mode === "rag" ? t("nav.modeRag") : t("nav.modeChat"),
        Icon: s.mode === "rag" ? SearchIcon : ChatIcon,
        run: () => {
          useSessionStore.getState().switchSession(s.id);
          navigate(`/${MODE_ROUTE[s.mode === "rag" ? "rag" : "llm"]}/${s.id}`);
          onClose();
        },
      }));

    return [...nav, ...actions, ...recent];
  }, [sessions, isAdmin, navigate, onClose, createSession, onToggleTheme, t]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(needle) ||
          (c.hint ?? "").toLowerCase().includes(needle),
      )
    : commands;

  // 结果集变化后游标可能越界，收敛到最后一条上（不 reset 到 0，避免打字时高亮跳走）
  const cursor = Math.min(active, Math.max(visible.length - 1, 0));
  const current = visible[cursor];

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const runAt = (index: number) => visible[index]?.run();

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 flex justify-center bg-[var(--overlay)] px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.aria")}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (visible.length ? (i + 1) % visible.length : 0));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (visible.length ? (i - 1 + visible.length) % visible.length : 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            runAt(cursor);
          }
        }}
        className="a-card anim-pop flex max-h-[60vh] w-full max-w-[32rem] flex-col overflow-hidden shadow-modal"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={current ? `cmd-${current.id}` : undefined}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.searchAria")}
          className="shrink-0 border-b border-line bg-transparent px-4 py-3 text-[--text-base] text-ink outline-none placeholder:text-ink-subtle"
        />

        <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-[--text-sm] text-ink-subtle">
              {t("palette.empty")}
            </p>
          ) : (
            visible.map((c, i) => {
              const selected = i === cursor;
              const showHeader = i === 0 || visible[i - 1]?.group !== c.group;
              return (
                <div key={c.id}>
                  {showHeader && (
                    <h3 className="a-section-title px-4 pb-1 pt-2 opacity-70">{c.group}</h3>
                  )}
                  <button
                    type="button"
                    id={`cmd-${c.id}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => c.run()}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-ui ${
                      selected ? "bg-accent-soft text-accent-ink" : "text-ink-muted"
                    }`}
                  >
                    <c.Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[--text-sm]">{c.label}</span>
                    {c.hint && (
                      <span className="shrink-0 text-[11px] text-ink-subtle">{c.hint}</span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line-subtle px-4 py-2 text-[11px] text-ink-subtle">
          <span>
            <kbd className="font-sans">↑</kbd>
            <kbd className="ml-0.5 font-sans">↓</kbd> {t("palette.select")}
          </span>
          <span>
            <kbd className="font-sans">Enter</kbd> {t("palette.run")}
          </span>
          <span>
            <kbd className="font-sans">Esc</kbd> {t("palette.close")}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
