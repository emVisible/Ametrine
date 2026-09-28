// src/pageView.tsx
import { Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { PageSkeleton } from "./components/PageSkeleton";
import { stableLazy, type PageLoader } from "./pageLoaders";

/**
 * 路由 element 的包装：错误边界 + 挂起骨架。
 *
 * 它是「返回元素的工厂」而不是组件（所以小写命名）——
 * 如果被当成组件，`lazy()` 就变成在渲染期创建组件，React 每次重渲染都会
 * 把整棵页面子树卸掉重建（状态丢失 + 内容区空一帧，也就是跳转白屏）。
 * 真正的稳定性由 pageLoaders.stableLazy 保证：同一引用只有一份 lazy。
 */
export function pageView(importFn: PageLoader) {
  const Page = stableLazy(importFn);

  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  );
}
