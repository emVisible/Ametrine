// src/components/ScopePicker.tsx
// 检索范围的级联选择器：hover 到知识库，右列立刻展开它的集合，最后一次点击落在集合上完成选择。
//
// 为什么不是两个下拉框：那两个下拉要把「选范围」拆成点开→看→再点开→再看四步，
// 而集合本来就从属于某个库 —— 级联把这层因果直接画成两列。
// 集合一次性取回后在本地按库分组：hover 时再发请求会出现「转圈 → 内容跳一下」，
// 预览型交互最忌讳的就是等待。
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/context";
import { ChevronDownIcon } from "./icons";
import type { KbCollection, KbDatabase } from "../types/knowledge";

export default function ScopePicker({
  databases,
  collectionsByDb,
  dbId,
  colId,
  onChange,
  loading = false,
}: {
  databases: KbDatabase[];
  collectionsByDb: Map<number, KbCollection[]>;
  dbId: number | null;
  colId: number | null;
  /** 一次给出库与集合；只点库时 colId 为 null（还不构成可发送的范围） */
  onChange: (dbId: number, colId: number | null) => void;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 预览库：hover / 键盘聚焦都会改它；只有 onChange 才写回真正的选择
  const [previewDb, setPreviewDb] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const db = databases.find((d) => d.id === dbId);
  const activeDb = previewDb ?? dbId ?? databases[0]?.id ?? null;
  const colsOf = (id: number | null) => (id == null ? [] : collectionsByDb.get(id) ?? []);
  const previewCols = colsOf(activeDb);
  const col = colId == null ? undefined : colsOf(dbId).find((c) => c.id === colId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative min-w-0 shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t("chat.scope")}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-[--radius-md] border px-2 py-1 text-[12px] transition-ui ${
          open
            ? "border-accent bg-surface"
            : "border-line bg-surface-sunken hover:border-accent-border"
        }`}
      >
        <span className={`max-w-[16rem] truncate ${col ? "text-ink" : "text-ink-subtle"}`}>
          {col
            ? `${db?.name} / ${col.name}`
            : db
              ? `${db.name} · ${t("chat.pickCol")}`
              : t("chat.scopePlaceholder")}
        </span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 text-ink-subtle transition-ui ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="a-card anim-pop absolute bottom-full z-30 mb-1 flex overflow-hidden shadow-pop">
          <ul
            aria-label={t("chat.pickKb")}
            className="max-h-64 w-44 overflow-y-auto py-1"
          >
            {databases.map((d) => {
              const n = colsOf(d.id).length;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setPreviewDb(d.id)}
                    onFocus={() => setPreviewDb(d.id)}
                    onClick={() => {
                      setPreviewDb(d.id);
                      onChange(d.id, null);
                    }}
                    aria-current={d.id === dbId}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-ui ${
                      d.id === activeDb
                        ? "bg-accent-soft text-accent-ink"
                        : "text-ink-muted hover:bg-surface-hover"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-subtle tnum">{n}</span>
                  </button>
                </li>
              );
            })}
            {databases.length === 0 && (
              <li className="px-3 py-2 text-[11px] text-ink-subtle">
                {t("chat.scopeNoDb")}
              </li>
            )}
          </ul>

          <ul
            aria-label={t("chat.pickCol")}
            className="max-h-64 w-52 overflow-y-auto border-l border-line-subtle py-1"
          >
            {loading && (
              <li className="px-3 py-2 text-[11px] text-ink-subtle">
                {t("common.loading")}
              </li>
            )}
            {!loading && previewCols.length === 0 && (
              <li className="px-3 py-2 text-[11px] text-ink-subtle">
                {t("chat.scopeNoCol")}
              </li>
            )}
            {!loading &&
              previewCols.map((c) => {
                const chosen = c.id === colId && activeDb === dbId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeDb != null) onChange(activeDb, c.id);
                        setPreviewDb(null);
                        setOpen(false);
                        trigger.current?.focus();
                      }}
                      aria-current={chosen}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-ui ${
                        chosen
                          ? "bg-accent-soft font-medium text-accent-ink"
                          : "text-ink-muted hover:bg-surface-hover"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.document_count != null && (
                        <span className="shrink-0 text-[11px] text-ink-subtle tnum">
                          {c.document_count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
