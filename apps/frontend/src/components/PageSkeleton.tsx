// src/components/PageSkeleton.tsx
/**
 * 路由分片还在路上的时候显示的东西。它必须是「有内容形状的骨架」而不是一行居中 spinner：
 * spinner 只占几十像素高，下面的内容区全是裸画布，跳转时看起来就是白屏。
 */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="页面加载中"
      className="mx-auto w-full max-w-[64rem] px-4 py-6 md:px-8"
    >
      <div className="mb-5">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton mt-2 h-3.5 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton h-24 w-full rounded-[--radius-md]" />
        ))}
      </div>
      <div className="sr-only">加载中…</div>
    </div>
  );
}
