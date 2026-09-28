// src/components/chat.tsx
// 对话页共用外壳：消息列表、单条消息、输入区。Chat 与 RAGChat 共用同一栅格，
// 此前两页的消息列宽 max-w-4xl 而输入框 max-w-3xl，视觉错位。
import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "./Markdown";
import { CheckIcon, CopyIcon, RefreshIcon, SparkIcon, StopIcon, WarningIcon } from "./icons";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  footer?: ReactNode;
}

export function MessageList({
  messages,
  empty,
  banner,
}: {
  messages: ChatMessage[];
  empty: ReactNode;
  /** 渲染在消息流末尾的持久提示（如失败与重试），不进入消息内容 */
  banner?: ReactNode;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  // 首屏不该整屏升起：只有本次挂载之后新增的消息才做入场动画。
  // 用惰性 state 存基准值而不是 ref——渲染期读 ref 是被 lint 禁止的（react-hooks/refs）。
  // <main key={pathname}> 会在切换会话时重挂载，基准值因此天然按会话重置。
  const [baseline] = useState(messages.length);

  useEffect(() => {
    if (pinned) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pinned]);

  // 用户向上翻阅时停止自动跟随，回到底部再恢复
  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  return (
    <div
      ref={boxRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-[54rem] px-4 py-6 md:px-6">
        {messages.length === 0 ? (
          empty
        ) : (
          <div className="space-y-7">
            {messages.map((m, i) => (
              <MessageRow key={i} message={m} animate={i >= baseline} />
            ))}
          </div>
        )}
        {banner && <div className="anim-fade mt-5">{banner}</div>}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function MessageRow({
  message,
  animate = false,
}: {
  message: ChatMessage;
  animate?: boolean;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板在非安全上下文不可用 */
    }
  };

  return (
    <article className={animate ? "anim-rise" : undefined}>
      <header className="mb-1.5 flex items-center gap-2">
        <span className="a-section-title">{isUser ? "你" : "Ametrine"}</span>
        {!isUser && !message.streaming && message.content && (
          <button
            type="button"
            onClick={copy}
            aria-label="复制回答"
            title="复制回答"
            className="a-btn a-btn-ghost ml-auto !px-1.5 !py-1"
          >
            {copied ? (
              <CheckIcon className="h-3.5 w-3.5 text-success" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </header>

      {isUser ? (
        <p className="whitespace-pre-wrap rounded-[--radius-lg] border-l-2 border-accent bg-surface-sunken px-3.5 py-2.5 text-[--text-sm] leading-relaxed text-ink">
          {message.content}
        </p>
      ) : (
        <div className="a-prose prose prose-sm max-w-none dark:prose-invert prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1">
          <Markdown content={message.content} />
          {message.streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[2px] animate-pulse bg-accent align-middle" />
          )}
        </div>
      )}

      {message.footer}
    </article>
  );
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  placeholder,
  leading,
  trailing,
  header,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  leading?: ReactNode;
  /** 渲染在输入框上方的上下文条（如已选检索范围） */
  header?: ReactNode;
  /** 渲染在工具行左侧的控件（如知识库/集合选择器） */
  trailing?: ReactNode;
  hint?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 224)}px`;
  }, [value]);

  const canSend = !!value.trim() && !busy && !disabled;

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      {/* 流式输出对读屏是静默的：只播报阶段状态，不播报逐字内容 */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {busy ? "正在生成回答，可按停止按钮中断" : ""}
      </span>
      <div className="mx-auto w-full max-w-[54rem] px-4 py-3 md:px-6">
        <div className="rounded-[--radius-lg] border border-line bg-surface transition-colors focus-within:border-accent">
          {header && (
            <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2.5 pb-1">
              {header}
            </div>
          )}
          <textarea
            ref={ref}
            rows={1}
            value={value}
            placeholder={placeholder}
            disabled={disabled || busy}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            className="w-full resize-none bg-transparent px-3.5 py-3 text-[--text-sm] leading-relaxed text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:text-ink-subtle"
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle px-2.5 py-1.5">
            {trailing}
            {leading}
            <span className="ml-auto hidden text-[11px] text-ink-subtle sm:inline">
              {hint ?? "Enter 发送 · Shift + Enter 换行"}
            </span>
            {busy && onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="a-btn a-btn-outline !px-2.5 !py-1 text-danger"
              >
                <StopIcon className="h-3.5 w-3.5" />
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSend}
                className="a-btn a-btn-primary !px-3 !py-1"
              >
                <SendGlyph />
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SendGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M4.5 12 20 4.5 15.5 20l-4-6z" />
      <path d="M11.5 14 20 4.5" />
    </svg>
  );
}

/**
 * 失败提示独立于消息正文。此前错误被直接写进助手消息的 content，
 * 既污染了会话历史与后续 chat_history，也没有重试入口。
 */
export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="anim-pop flex items-start gap-2.5 rounded-[--radius-lg] border border-danger-border bg-danger-soft px-3.5 py-2.5"
    >
      <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <p className="min-w-0 flex-1 text-[--text-sm] leading-relaxed text-danger">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="a-btn a-btn-outline shrink-0 !py-1 text-[11px]"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          重试
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  aside,
}: {
  icon: typeof SparkIcon;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-sunken text-ink-subtle">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="text-[--text-lg] font-semibold text-ink">{title}</h2>
      <p className="mt-1.5 max-w-sm text-[--text-sm] leading-relaxed text-ink-muted">
        {description}
      </p>
      {aside && <div className="mt-6 w-full max-w-sm">{aside}</div>}
    </div>
  );
}
