// src/utils/pageTitles.ts
// 标签页标题跟着路由走：多标签 browsing 时用户要能认出哪个是知识库、哪个是检索会话。
// 这里只负责「路径 → 文案键」，翻译由调用方用当前语言的 t() 完成。
import type { MsgKey } from "../i18n";

export const APP_NAME = "Ametrine";

/** 按路径段匹配，否则 "/chats" 会被当成 "/chat" 的子页。 */
function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const TITLES: { match: (path: string) => boolean; key: MsgKey }[] = [
  { match: (p) => under(p, "/dashboard"), key: "page.dashboard" },
  { match: (p) => under(p, "/chat"), key: "page.chat" },
  { match: (p) => under(p, "/rag"), key: "page.rag" },
  { match: (p) => under(p, "/admin/vector"), key: "page.vector" },
  { match: (p) => under(p, "/admin/access"), key: "page.access" },
  // 这两条之前漏了 /admin/queue：标签页标题会退回只剩站名，
  // 多标签浏览时分不清哪个窗口是队列。补上，和新页一起过测试。
  { match: (p) => under(p, "/admin/queue"), key: "page.queue" },
  { match: (p) => under(p, "/admin/inference"), key: "page.inference" },
  // 租户子页面用租户名以外的通用标题：这里拿不到租户名（数据在页面里加载），
  // 编一个 id 进标题反而不如稳定的「租户详情」。
  { match: (p) => under(p, "/admin/tenants"), key: "page.tenantDetail" },
  { match: (p) => under(p, "/settings"), key: "page.settings" },
  { match: (p) => under(p, "/profile"), key: "page.profile" },
  { match: (p) => under(p, "/403"), key: "page.forbidden" },
];

/** 返回文案键（如 "page.chat"）而不是成品文字：调用方可能是组件外，也可能是测试。 */
export function pageTitleForPath(pathname: string): MsgKey | null {
  return TITLES.find((t) => t.match(pathname))?.key ?? null;
}

/**
 * 传入**已经翻译好**的界面文字（或 null）。
 * 不在这里读模块级 currentLang：Provider 写那个值用的是 effect，而子组件的 effect
 * 先于父组件跑，切语言的那一次 commit 里这里拿到的还是旧语言 —— 实测标题会慢一拍。
 */
export function applyDocumentTitle(label: string | null) {
  document.title = label ? `${label} · ${APP_NAME}` : APP_NAME;
}
