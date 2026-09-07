import { type ComponentType, lazy, Suspense } from 'react'
import ErrorBoundary from './ErrorBoundary'

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
  </div>
)

export function LazyPage(importFn: () => Promise<{ default: ComponentType<any> }>) {
  const Component = lazy(importFn)

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  )
}