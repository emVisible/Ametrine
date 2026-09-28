// src/utils/redirect.ts
// 登录成功后的「来路」来自 URL state，属于外部输入：必须确认是站内路径，
// 否则 <a href="//evil.com"> 这种协议相对写法就把用户送出了本站。
const FALLBACK = "/dashboard";
const SELF = ["/login", "/register"];

export function safeRedirect(from: unknown, fallback = FALLBACK): string {
  if (typeof from !== "string") return fallback;
  const internal =
    from.startsWith("/") && !from.startsWith("//") && !from.includes("\\");
  if (!internal) return fallback;
  const path = from.split(/[?#]/)[0] ?? from;
  // 回到登录页自身只会形成一次无意义的重定向
  if (SELF.includes(path)) return fallback;
  return from;
}
