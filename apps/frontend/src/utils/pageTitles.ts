// src/utils/pageTitles.ts
// 标签页标题跟着路由走：多标签 browsing 时用户要能认出哪个是知识库、哪个是检索会话。
export const APP_NAME = "Ametrine";

/** 按路径段匹配，否则 "/chats" 会被当成 "/chat" 的子页。 */
function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const TITLES: { match: (path: string) => boolean; label: string }[] = [
  { match: (p) => under(p, "/dashboard"), label: "概览" },
  { match: (p) => under(p, "/chat"), label: "对话" },
  { match: (p) => under(p, "/rag"), label: "检索问答" },
  { match: (p) => under(p, "/admin/vector"), label: "知识库" },
  { match: (p) => under(p, "/admin/access"), label: "组织与权限" },
  { match: (p) => under(p, "/settings"), label: "系统设置" },
  { match: (p) => under(p, "/profile"), label: "个人资料" },
  { match: (p) => under(p, "/403"), label: "无权访问" },
];

export function pageTitleForPath(pathname: string): string | null {
  return TITLES.find((t) => t.match(pathname))?.label ?? null;
}

export function applyDocumentTitle(page: string | null) {
  document.title = page ? `${page} · ${APP_NAME}` : APP_NAME;
}
