import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import "./index.css";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { ConfirmProvider } from "./components/ui";
import ErrorBoundary from "./components/ErrorBoundary";
import { installChunkRecovery, markBooted } from "./utils/chunkRecovery";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 后端列表端点没有分页与 ETag，重挂载即全量重拉；给一个保守的缓存窗口
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// 入口分片本身加载失败时 React 根本没机会跑起来，只能靠浏览器层兜住
installChunkRecovery();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            {/* 根级兜底：路由匹配/守卫/懒加载工厂之外的任何抛错，
                没有这一层就会直接把 #root 留空 —— 用户看到的就是全白屏 */}
            <ErrorBoundary
              fallback={
                <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
                  <div className="a-card max-w-md p-5 text-center">
                    <h1 className="text-[--text-lg] font-semibold text-ink">
                      界面没能启动
                    </h1>
                    <p className="mt-1.5 text-[--text-sm] leading-relaxed text-ink-muted">
                      可能是版本刚更新过，浏览器还在用旧的页面缓存。
                    </p>
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="a-btn a-btn-primary mt-4"
                    >
                      重新加载
                    </button>
                  </div>
                </div>
              }
            >
              <RouterProvider router={router} />
            </ErrorBoundary>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// 解除 index.html 的启动看门狗。用 setTimeout 而不是 rAF：后台标签页里 rAF
// 根本不跑，用 rAF 会让「开了标签页没看」的用户在 6 秒后被强制刷新一次。
window.setTimeout(markBooted, 0);
