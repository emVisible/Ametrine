// src/components/Markdown.tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface MarkdownProps {
  content: string
}

export default function Markdown({ content }: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 代码块渲染
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const codeString = String(children).replace(/\n$/, '')

          // 行内代码
          if (!match && !String(children).includes('\n')) {
            return (
              <code
                className="px-1.5 py-0.5 bg-gray-100 text-red-600 rounded text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            )
          }

          // 代码块
          return (
            <SyntaxHighlighter
              style={oneDark}
              language={match ? match[1] : ''}
              PreTag="div"
              customStyle={{
                margin: '0.75rem 0',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
              }}
            >
              {codeString}
            </SyntaxHighlighter>
          )
        },
        // 链接在新窗口打开
        a({ children, href, ...props }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline hover:text-indigo-800"
              {...props}
            >
              {children}
            </a>
          )
        },
        // 表格样式
        table({ children }) {
          return (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse border border-gray-300 text-sm">
                {children}
              </table>
            </div>
          )
        },
        th({ children }) {
          return (
            <th className="border border-gray-300 px-3 py-2 bg-gray-100 font-semibold text-left">
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td className="border border-gray-300 px-3 py-2">{children}</td>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}