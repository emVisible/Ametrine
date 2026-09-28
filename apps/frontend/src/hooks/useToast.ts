// src/hooks/useToast.ts
import { createContext, useContext } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}
