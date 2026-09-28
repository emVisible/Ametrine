// src/hooks/useTheme.ts
// context 与 hook 单独成文件：组件文件同时导出组件和 hook 会让 react-refresh
// 失去 Fast Refresh 能力（改一行样式就整页重载）。
import { createContext, useContext } from "react";

export type Theme = "light" | "dark";

export const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
}>({ theme: "light", toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}
