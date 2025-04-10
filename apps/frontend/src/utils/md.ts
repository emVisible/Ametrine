import highlight from "highlight.js";
import Markdown from "markdown-it";
import 'highlight.js/styles/atom-one-dark.css'
function removeSpaces(strings: TemplateStringsArray, ...values: any[]) {
  return strings
    .map((str, i) => `${str.replace(/\s+/g, ' ').trim()}${values[i] || ''}`)
    .join('');
}
const mdOptions = {
  html: true,        // 在源码中启用 HTML 标签
  linkify: true,     // 将类似 URL 的文本自动转换为链接。
  typographer: true, // 双 + 单引号替换对，当 typographer 启用时。
  breaks: true,      // 转换段落里的 '\n' 到 <br>。
  langPrefix: "language-",
  // 代码高亮
  highlight(str: any, lang: any) {
    if (lang && highlight.getLanguage(lang)) {
      try {
        return removeSpaces`
            <pre class="w-full p-4 my-2 break-words break-all bg-[#4b4b4b] rounded-lg">
              <code class="hljs" style="background:#4b4b4b;">
                ${highlight.highlight(str, { language: lang, ignoreIllegals: true }).value}
              </code>
            </pre>
          `
      } catch (__) { }
    }
    return "";
  },
}

// export const md = new Markdown(mdOptions);
export const md = new Markdown(mdOptions)
