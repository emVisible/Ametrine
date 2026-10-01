/**
 * 角色 -> 文案键 / 徽章色调。
 *
 * 单独成文件是因为 react-refresh 只允许组件文件导出组件：
 * 把这两个纯函数放在 adminAccessShared.tsx 里会让那个文件失去 fast refresh。
 */

import type { MsgKey } from "../i18n";

/** 存文案键而不是文案：模块级常量存译文的话，切语言后仍然是旧语言 */
const ROLE_KEYS: Record<number, MsgKey> = {
  1: "common.roleUser",
  2: "common.roleManager",
  3: "common.roleAdmin",
};

/** 未知角色 id 由这里统一兜到「未知」文案，调用方不必各自再写一遍 */
export function roleKeyOf(roleId: number): MsgKey {
  return ROLE_KEYS[roleId] ?? "common.unknown";
}

// 只有管理员值得用强调色，其余角色保持中性：
// 一屏里出现多个彩色徽章时，颜色就不再传递信息了。
export function roleTone(roleId: number) {
  return roleId === 3 ? ("accent" as const) : ("neutral" as const);
}
