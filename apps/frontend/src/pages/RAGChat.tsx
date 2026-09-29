// src/pages/RAGChat.tsx
import { useCallback, useMemo, useState } from "react";
import { streamRAG } from "../api/chat";
import { type HistoryMessage } from "../stores/sessionStore";
import useSessionStore from "../stores/sessionStore";
import {
  beginStream,
  endStream,
  failStream,
  stopStream,
} from "../stores/streamStore";
import { useSessionMessages } from "../hooks/useSessionMessages";
import { useAllCollections, useDatabases } from "../hooks/queries";
import { useI18n } from "../i18n/context";
import VoiceInput from "../components/VoiceInput";
import {
  EmptyState,
  ErrorNotice,
  MessageList,
  Composer,
  type ChatMessage,
} from "../components/chat";
import { StatusBadge } from "../components/ui";
import ScopePicker from "../components/ScopePicker";
import type { KbCollection } from "../types/knowledge";
import {
  FileIcon,
  InfoIcon,
  QuoteIcon,
  SearchIcon,
  WarningIcon,
} from "../components/icons";

interface Reference {
  title: string;
  uploader?: string;
  source?: string;
  created_at?: string;
  relevance_score?: number;
  chunk_id?: number;
}

interface RagMessage extends HistoryMessage {
  references?: Reference[];
}

/**
 * 引用面板。后端当前只回传 {title, uploader, source, created_at, relevance_score, chunk_id}，
 * 不含 document_id / 页码，所以这里只能做只读展示，不能承诺点击回溯到原文位置。
 */
function ReferencePanel({ refs }: { refs: Reference[] }) {
  const { t } = useI18n();

  const scoreTone = (score: number) =>
    score >= 0.6
      ? { label: t("rag.high"), bar: "bg-accent", text: "text-accent-ink" }
      : score >= 0.3
        ? { label: t("rag.mid"), bar: "bg-ink-subtle", text: "text-ink-muted" }
        : { label: t("rag.low"), bar: "bg-warning", text: "text-warning" };

  return (
    <section className="a-card mt-3 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line-subtle bg-surface-sunken px-3 py-2">
        <QuoteIcon className="h-3.5 w-3.5 text-ink-subtle" />
        <h3 className="a-section-title">{t("chat.references")}</h3>
        <span className="a-badge ml-auto border-line bg-surface text-ink-muted tnum">
          {refs.length}
        </span>
      </header>
      <ol className="divide-y divide-line-subtle" aria-label={t("rag.refList")}>
        {refs.map((ref, i) => {
          const score = ref.relevance_score ?? 0;
          const tone = scoreTone(score);
          return (
            <li key={i} className="px-3 py-2.5">
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[--radius-xs] border border-line bg-surface text-[10px] font-medium text-ink-muted tnum"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[--text-sm] font-medium text-ink">
                    <span className="sr-only">
                      {t("rag.refN", { n: i + 1 })}
                    </span>
                    {ref.title || t("rag.untitled")}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-subtle">
                    {ref.uploader && <span>{ref.uploader}</span>}
                    {ref.created_at && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="tnum">{ref.created_at.slice(0, 10)}</span>
                      </>
                    )}
                    {ref.chunk_id != null && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="tnum">{t("rag.chunk", { n: ref.chunk_id })}</span>
                      </>
                    )}
                  </p>
                  {ref.source && (
                    // 后端只给文件来源、不给命中片段，所以这里不能排成「引用原文」的样子
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-subtle">
                      <FileIcon className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="min-w-0 truncate" title={ref.source}>
                        {ref.source}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {score > 0 && (
                    <>
                      <span className={`text-[11px] font-medium tnum ${tone.text}`}>
                        {(score * 100).toFixed(0)}%
                      </span>
                      <StatusBadge
                        tone={score >= 0.6 ? "accent" : score >= 0.3 ? "neutral" : "warning"}
                      >
                        {tone.label}
                      </StatusBadge>
                    </>
                  )}
                </div>
              </div>
              {score > 0 && (
                <div className="ml-6.5 mt-2 h-[3px] overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className={`h-full rounded-full ${tone.bar}`}
                    style={{ width: `${Math.min(score, 1) * 100}%` }}
                  />
                </div>
              )}
              {score > 0 && score < 0.3 && (
                <p className="ml-6.5 mt-1.5 flex items-center gap-1.5 text-[11px] text-warning">
                  <WarningIcon className="h-3 w-3 shrink-0" />
                  {t("rag.lowNote")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** 回答没有引用任何分块时的说明：不让用户面对一段「看起来像有据、其实无据」的文字。 */
function NoReferenceNote() {
  const { t } = useI18n();
  return (
    <p className="mt-3 flex items-start gap-2 rounded-[--radius-md] border border-line bg-surface-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      {t("chat.noReference")}
    </p>
  );
}

export default function RAGChatPage() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [selectedDbId, setSelectedDbId] = useState<number | null>(null);
  const [selectedColId, setSelectedColId] = useState<number | null>(null);

  const {
    messages,
    sessionId,
    streaming,
    error,
    ensureSession,
    clearError,
  } = useSessionMessages<RagMessage>("rag");

  const { data: databases } = useDatabases();
  const { data: allCollections, isLoading: collectionsLoading } =
    useAllCollections();
  // 一次性取回后本地分组：级联选择器 hover 时不能再等请求
  const collectionsByDb = useMemo(() => {
    const map = new Map<number, KbCollection[]>();
    for (const c of allCollections ?? []) {
      const key = c.database_id ?? 0;
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [allCollections]);

  const selectedDb = databases?.find((db) => db.id === selectedDbId);
  const selectedCol =
    selectedDbId == null || selectedColId == null
      ? undefined
      : (collectionsByDb.get(selectedDbId) ?? []).find(
          (c: KbCollection) => c.id === selectedColId,
        );

  const stop = useCallback(() => {
    if (!sessionId) return;
    useSessionStore.getState().discardEmptyTurn(sessionId);
    stopStream(sessionId);
  }, [sessionId]);

  const handleSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || streaming || !selectedDb || !selectedCol) return;

    // 与 Chat 页一致：会话在发送这一刻才建，访问 /rag 不再凭空写库
    const id = await ensureSession();
    if (!id) return;

    const controller = beginStream(id);
    if (!controller) return;

    const history = useSessionStore.getState().beginTurn(id, prompt);
    setInput("");
    clearError();

    void streamRAG(
      {
        prompt,
        chat_history: history,
        database_name: selectedDb.name,
        collection_name: selectedCol.name,
      },
      (token) => useSessionStore.getState().appendToken(id, token),
      (refs) => {
        useSessionStore
          .getState()
          .patchLast(id, { references: (refs as Reference[]) || [] });
        endStream(id);
      },
      (err) => {
        useSessionStore.getState().discardEmptyTurn(id);
        failStream(id, err.message);
      },
      controller.signal,
    );
  }, [
    input,
    streaming,
    selectedDb,
    selectedCol,
    ensureSession,
    clearError,
  ]);

  const view: ChatMessage[] = messages.map((m, i) => {
    const isStreaming =
      m.role === "assistant" && streaming && i === messages.length - 1;
    return {
      role: m.role,
      content: m.content,
      streaming: isStreaming,
      // 只有生成结束才判定「有没有引用」：流式途中 references 还是 undefined
      footer:
        m.role === "assistant" && !isStreaming
          ? m.references?.length
            ? <ReferencePanel refs={m.references} />
            : Array.isArray(m.references)
              ? <NoReferenceNote />
              : undefined
          : undefined,
    };
  });

  const scopeReady = !!selectedDb && !!selectedCol;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <MessageList
        messages={view}
        banner={
          error ? <ErrorNotice message={error} onRetry={handleSubmit} /> : undefined
        }
        empty={
          <EmptyState
            icon={SearchIcon}
            title={t("chat.emptyRagTitle")}
            description={
              !selectedDbId
                ? t("chat.emptyRagDesc")
                : !selectedColId
                  ? t("chat.emptyRagCol")
                  : t("rag.emptyReady")
            }
            aside={
              <p className="text-[11px] text-ink-subtle">{t("chat.enterHint")}</p>
            }
          />
        }
      />

      {/* 检索范围、重排序与发送都排在输入框的同一条 band 里：
          横向空间本来就有，不必再叠一层工具行把正文顶高 */}
      <Composer
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        busy={streaming}
        disabled={!scopeReady}
        placeholder={
          scopeReady ? t("chat.ragPlaceholder") : t("chat.needScope")
        }
        context={
          <>
            {/* 级联选择：hover 到知识库就在右列展开它的集合，点集合一次完成选择。
                原来的两个下拉把这件事拆成点开→看→再点开→再看四步。 */}
            <ScopePicker
              databases={databases ?? []}
              collectionsByDb={collectionsByDb}
              dbId={selectedDbId}
              colId={selectedColId}
              loading={collectionsLoading}
              onChange={(dbId, colId) => {
                setSelectedDbId(dbId);
                // 换库必然使已选集合失效；点集合时才会带上 colId
                setSelectedColId(colId);
              }}
            />
          </>
        }
        right={
          <VoiceInput
            onResult={(text) =>
              setInput((prev) => (prev ? `${prev} ${text}` : text))
            }
            disabled={streaming}
          />
        }
      />
    </div>
  );
}
