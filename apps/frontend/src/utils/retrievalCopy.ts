// src/utils/retrievalCopy.ts
// 一条检索事实 → 一行可读判据。
//
// 为什么不在 AdminQueue.tsx 里：react-refresh 只允许页面文件导出组件，纯函数留在页面里
// 会让整个页面模块失去 fast refresh（`react-refresh/only-export-components`），
// 而这条判据恰恰是最常被改、最需要热更的部分。和 utils/roles.ts 同一个理由。
import type { UnresolvedRow } from "../api/converstion";
import type { useI18n } from "../i18n/context";

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * 把一条检索事实压成一行可读的判据。
 *
 * 这三种「没答上」的修法完全不同，界面必须一眼分得开：
 * 库里没内容（去补文档）/ 有内容但被阈值筛光（去调阈值或改写问法）/ 取回了却没用好（去修切分）。
 * 分数只在重排真的给过时才写：没有 `score_max` 还硬印一个 0.00，是编造证据。
 */
export function describeRetrieval(
  r: NonNullable<UnresolvedRow["retrieval"]>,
  t: Translate,
): string {
  if (r.outcome === "no_hits") return t("queue.retrieval.noHits");
  if (r.outcome === "filtered_out")
    return t("queue.retrieval.filteredOut", { c: r.candidates, k: r.top_k });
  const score =
    typeof r.score_max === "number"
      ? t("queue.retrieval.withScore", {
          c: r.candidates,
          n: r.returned,
          s: r.score_max.toFixed(2),
        })
      : t("queue.retrieval.plain", { c: r.candidates, n: r.returned });
  return `${score} · ${r.elapsed_ms}ms`;
}
