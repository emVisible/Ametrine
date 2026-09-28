// src/components/Markdown.tsx
import { Suspense, createElement, lazy, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";
import { CheckIcon, CopyIcon } from "./icons";

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
          aria-label="复制代码"
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

export default function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
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
