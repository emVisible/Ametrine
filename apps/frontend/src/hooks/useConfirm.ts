// src/hooks/useConfirm.ts
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "accent";
}

export const ConfirmContext = createContext<
  (o: ConfirmOptions) => Promise<boolean>
>(async () => false);

/** `await confirm({...})` 形式的删除/提权二次确认。 */
export function useConfirm() {
  return useContext(ConfirmContext);
}
