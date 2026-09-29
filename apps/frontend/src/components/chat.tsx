// src/components/chat.tsx
// 对话页共用外壳：消息列表、单条消息、输入区。Chat 与 RAGChat 共用同一栅格，
// 此前两页的消息列宽 max-w-4xl 而输入框 max-w-3xl，视觉错位。
import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "./Markdown";
import { useI18n } from "../i18n/context";
import {
  CheckIcon,
  CopyIcon,
  RefreshIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
  WarningIcon,
} from "./icons";

/** 消息列与输入区共用的内容宽度：两侧留白换成正文可用的横向空间 */
const COLUMN = "mx-auto w-full max-w-[60rem] px-4 md:px-6";

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
      <div className={`${COLUMN} py-5`}>
        {messages.length === 0 ? (
          empty
        ) : (
          <div className="space-y-6">
            {messages.map((m, i) => (
              <MessageRow key={i} message={m} animate={i >= baseline} />
            ))}
          </div>
        )}
        {banner && <div className="anim-fade mt-4">{banner}</div>}
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
  const { t } = useI18n();
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
        <span className="a-section-title">
          {isUser ? t("common.you") : t("chat.ametrine")}
        </span>
        {!isUser && !message.streaming && message.content && (
          <button
            type="button"
            onClick={copy}
            aria-label={t("common.copyAnswer")}
            title={t("common.copyAnswer")}
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

/**
 * 输入区。上一版被推翻的原因，这里写成约束：
 *  - 输入框必须拿到这一行的主要宽度。快捷键提示、检索范围控件都是次要信息，
 *    和 textarea 抢横向空间就会把输入挤没（检索页上曾只剩两三个字宽）。
 *  - 提示不该占布局：Enter 发送写进空状态 + title/aria-describedby，界面上不再单独占一格。
 *  - 检索范围是「当前上下文」而不是「按钮」，所以放输入框上方的细条：
 *    自己换行、自己占高，不参与输入行的宽度分配。
 *  - 发送/停止用图标按钮（带 aria-label 与 title），文字标签在窄屏纯属浪费。
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  placeholder,
  context,
  right,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  /** 输入框上方的上下文条（如知识库/集合/重排序） */
  context?: ReactNode;
  /** 输入框右侧、发送按钮之前的控件（如语音输入；默认不渲染） */
  right?: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const hint = t("chat.enterHint");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = !!value.trim() && !busy && !disabled;

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      {/* 流式输出对读屏是静默的：只播报阶段状态，不播报逐字内容 */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {busy ? t("chat.liveRegion") : ""}
      </span>
      <div className={`${COLUMN} pb-3 pt-2`}>
        {context && (
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {context}
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-[--radius-lg] border border-line bg-surface px-2 py-1.5 shadow-card transition-colors focus-within:border-accent">
          <textarea
            ref={ref}
            id="chat-composer"
            rows={1}
            value={value}
            placeholder={placeholder}
            disabled={disabled || busy}
            title={hint}
            aria-describedby="chat-composer-hint"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            className="min-h-[26px] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[--text-sm] leading-relaxed text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:text-ink-subtle"
          />
          {right}
          {busy && onStop ? (
            <button
              type="button"
              onClick={onStop}
              title={t("chat.stopTitle")}
              aria-label={t("chat.stopTitle")}
              className="a-btn a-btn-outline !h-8 !w-8 shrink-0 !px-0 !py-0 text-danger"
            >
              <StopIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSend}
              title={t("chat.send")}
              aria-label={t("chat.send")}
              className="a-btn a-btn-primary !h-8 !w-8 shrink-0 !px-0 !py-0"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <span id="chat-composer-hint" className="sr-only">
          {hint}
        </span>
      </div>
    </div>
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
  const { t } = useI18n();
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
          {t("common.retry")}
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
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
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
