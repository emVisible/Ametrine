// src/components/LazyPage.tsx
import { type ComponentType, lazy, Suspense } from "react";
import ErrorBoundary from "./ErrorBoundary";
import { Loading } from "./ui";

export function LazyPage(importFn: () => Promise<{ default: ComponentType }>) {
  const Component = lazy(importFn);

  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  );
}
