// src/pages/RAGChat.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { streamRAG } from "../api/chat";
import { type HistoryMessage } from "../stores/sessionStore";
import { useSessionMessages } from "../hooks/useSessionMessages";
import { useCollections, useDatabases } from "../hooks/queries";
import VoiceInput from "../components/VoiceInput";
import { EmptyState, ErrorNotice, MessageList, Composer, type ChatMessage } from "../components/chat";
import { Select, StatusBadge, Toggle } from "../components/ui";
import { FileIcon, InfoIcon, QuoteIcon, SearchIcon, WarningIcon } from "../components/icons";

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

function scoreTone(score: number) {
  if (score >= 0.6) return { label: "高相关", bar: "bg-accent", text: "text-accent-ink" };
  if (score >= 0.3) return { label: "中相关", bar: "bg-ink-subtle", text: "text-ink-muted" };
  return { label: "低相关", bar: "bg-warning", text: "text-warning" };
}

/**
 * 引用面板。后端当前只回传 {title, uploader, source, created_at, relevance_score, chunk_id}，
 * 不含 document_id / 页码，所以这里只能做只读展示，不能承诺点击回溯到原文位置。
 */
function ReferencePanel({ refs }: { refs: Reference[] }) {
  return (
    <section className="a-card mt-3 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line-subtle bg-surface-sunken px-3 py-2">
        <QuoteIcon className="h-3.5 w-3.5 text-ink-subtle" />
        <h3 className="a-section-title">引用来源</h3>
        <span className="a-badge ml-auto border-line bg-surface text-ink-muted tnum">
          {refs.length}
        </span>
      </header>
      <ol className="divide-y divide-line-subtle" aria-label="引用来源列表">
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
                    <span className="sr-only">第 {i + 1} 条引用：</span>
                    {ref.title || "未命名文档"}
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
                        <span className="tnum">分块 #{ref.chunk_id}</span>
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
                  与问题相关性较低，可能不构成有效依据
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
  return (
    <p className="mt-3 flex items-start gap-2 rounded-[--radius-md] border border-line bg-surface-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      这次回答没有引用知识库分块：可能没有足够相关的段落，也可能是相关性阈值把候选都过滤掉了。换个更具体的说法再试。
    </p>
  );
}

export default function RAGChatPage() {
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDbId, setSelectedDbId] = useState<number | null>(null);
  const [selectedColId, setSelectedColId] = useState<number | null>(null);
  const [enableRerank, setEnableRerank] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const {
    messages,
    ensureSession,
    beginTurn,
    appendToken,
    finishTurn,
    discardEmptyTurn,
  } = useSessionMessages<RagMessage>("rag");

  const { data: databases } = useDatabases();
  const { data: collections } = useCollections(selectedDbId);

  const selectedDb = databases?.find((db) => db.id === selectedDbId);
  const selectedCol = collections?.find((col) => col.id === selectedColId);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    discardEmptyTurn();
  }, [discardEmptyTurn]);

  const handleSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming || !selectedDb || !selectedCol) return;

    // 与 Chat 页一致：会话在发送这一刻才建，访问 /rag 不再凭空写库
    if (!(await ensureSession())) return;

    const history = beginTurn(prompt);
    setInput("");
    setIsStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamRAG(
      {
        prompt,
        chat_history: history,
        database_name: selectedDb.name,
        collection_name: selectedCol.name,
        rerank: enableRerank,
      },
      appendToken,
      (refs) => {
        finishTurn(() => ({ references: (refs as Reference[]) || [] }));
        setIsStreaming(false);
        abortRef.current = null;
      },
      (err) => {
        discardEmptyTurn();
        setError(err.message);
        setIsStreaming(false);
        abortRef.current = null;
      },
      controller.signal,
    );
  }, [
    input,
    isStreaming,
    selectedDb,
    selectedCol,
    enableRerank,
    ensureSession,
    beginTurn,
    appendToken,
    finishTurn,
    discardEmptyTurn,
  ]);

  const view: ChatMessage[] = messages.map((m, i) => {
    const streaming =
      m.role === "assistant" && isStreaming && i === messages.length - 1;
    return {
      role: m.role,
      content: m.content,
      streaming,
      // 只有生成结束才判定「有没有引用」：流式途中 references 还是 undefined
      footer:
        m.role === "assistant" && !streaming
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
            title="基于知识库检索作答"
            description={
              !selectedDbId
                ? "先在输入框下方选择知识库，回答只会引用该范围内的文档分块。"
                : !selectedColId
                  ? "再选择一个集合来限定检索范围。"
                  : "输入问题，系统会检索相关分块并给出带引用的回答。"
            }
          />
        }
      />

      {/* 检索范围、重排序与发送都在同一个输入面里，不再上下分置 */}
      <Composer
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        busy={isStreaming}
        disabled={!scopeReady}
        placeholder={
          scopeReady ? "输入问题，检索当前集合…" : "请先选择知识库与集合"
        }
        hint="Enter 发送 · Shift + Enter 换行"
        header={
          <>
            <span className="a-section-title">检索范围</span>
            {scopeReady ? (
              <StatusBadge tone="accent">
                {selectedDb!.name}
                <span className="opacity-50" aria-hidden>
                  /
                </span>
                {selectedCol!.name}
              </StatusBadge>
            ) : (
              <StatusBadge tone="neutral">未选择</StatusBadge>
            )}
          </>
        }
        trailing={
          <>
            <Select
              aria-label="选择知识库"
              value={selectedDbId ?? ""}
              onChange={(e) => {
                setSelectedDbId(e.target.value ? Number(e.target.value) : null);
                // 换库必然使已选集合失效，直接在动作里清掉而不是用 effect 同步
                setSelectedColId(null);
              }}
              placeholder="选择知识库"
              className="!w-auto !py-1 text-[11px]"
              options={(databases ?? []).map((db) => ({
                value: db.id,
                label: db.name,
              }))}
            />
            <Select
              aria-label="选择集合"
              value={selectedColId ?? ""}
              onChange={(e) =>
                setSelectedColId(e.target.value ? Number(e.target.value) : null)
              }
              disabled={!selectedDbId}
              placeholder="选择集合"
              className="!w-auto !py-1 text-[11px]"
              options={(collections ?? []).map((col) => ({
                value: col.id,
                label: col.name,
              }))}
            />
            <Toggle
              checked={enableRerank}
              onChange={setEnableRerank}
              label="重排序"
            />
          </>
        }
        leading={
          <VoiceInput
            onResult={(text) =>
              setInput((prev) => (prev ? `${prev} ${text}` : text))
            }
            disabled={isStreaming}
          />
        }
      />
    </div>
  );
}
