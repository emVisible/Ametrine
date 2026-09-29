// src/components/charts.tsx
// 概览页的三个图形：时间柱、占比条、租户↔知识库二分图。
//
// 为什么不引图表库（Recharts / visx / ECharts 任选其一都能覆盖这三个）：
//  1. 它们自带一套配色与字号，最终必须再做一次「把 token 塞回去」的适配层，
//     而这套适配代码比手写 SVG 更长；这里的每个 fill/stroke 都直接是 --c-* 令牌，
//     深色主题不需要任何额外处理。
//  2. 交互只有一种（悬停高亮），库的 tooltip/legend/brush 状态机用不上却要背下来。
//  3. 概览是首屏。为一个静态图引入几十 KB 的渲染层，代价落在最不该慢的页面上。
// 真要加时间序列的多轴、缩放或力导向布局时再引入不迟 —— 那才是手写会开始亏的拐点。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";

const TONE_FILL: Record<string, string> = {
  accent: "fill-accent",
  success: "fill-success",
  warning: "fill-warning",
  danger: "fill-danger",
  neutral: "fill-line-strong",
};

const TONE_STROKE: Record<string, string> = {
  accent: "stroke-accent",
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
  neutral: "stroke-line-strong",
};

/* ───────────── 时间柱状图 ───────────── */

export function BarSeries({
  points,
  unit,
}: {
  points: { date: string; documents: number }[];
  /** 纵轴与 title 里的量纲，比如「篇」 */
  unit: string;
}) {
  const { t } = useI18n();
  const total = points.reduce((s, p) => s + p.documents, 0);
  // 真实峰值单独留着给文案用：绘图用的尺度必须 ≥1，否则除零，
  // 但把「没有活动」报成「峰值 1 篇」就是假读数。
  const peak = Math.max(0, ...points.map((p) => p.documents));
  const scale = Math.max(1, peak);

  return (
    <div>
      {/* role=img + aria-label：柱状图对读屏是一整幅图，逐根念数字只会更糟 */}
      <div
        role="img"
        aria-label={t("dash.chart.activityLabel", { n: points.length, total, unit })}
        className="flex h-28 items-end gap-[3px]"
      >
        {points.map((p) => {
          const pct = (p.documents / scale) * 100;
          return (
            <div
              key={p.date}
              className="group relative flex h-full flex-1 items-end"
              title={`${p.date} · ${p.documents} ${unit}`}
            >
              <div
                className={`w-full rounded-t-[2px] transition-colors ${
                  p.documents ? "bg-accent-soft group-hover:bg-accent" : "bg-surface-hover"
                }`}
                // 0 也要留一条 2px 的基线痕迹：完全不画会让人以为数据缺失而不是没有活动
                style={{ height: p.documents ? `${Math.max(pct, 4)}%` : "2px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-ink-subtle tnum">
        <span>{points[0]?.date.slice(5) ?? ""}</span>
        <span>{t("dash.chart.peakN", { n: peak, unit })}</span>
        <span>{points[points.length - 1]?.date.slice(5) ?? ""}</span>
      </div>
    </div>
  );
}

/* ───────────── 占比条 ───────────── */

export function StackedBar({
  segments,
}: {
  segments: { key: string; label: string; value: number; tone: keyof typeof TONE_FILL }[];
}) {
  const { t } = useI18n();
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) {
    return (
      <p className="py-3 text-[--text-sm] text-ink-subtle">{t("dash.noIndexData")}</p>
    );
  }
  return (
    <div>
      <div
        role="img"
        aria-label={segments
          .filter((s) => s.value)
          .map((s) => `${s.label} ${s.value}`)
          .join(" · ")}
        className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-surface-sunken"
      >
        {segments.map((s) =>
          s.value ? (
            <span
              key={s.key}
              className={TONE_FILL[s.tone]}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label} · ${s.value.toLocaleString(intlLocale())}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[11px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_FILL[s.tone]}`} />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{s.label}</span>
            <span className="shrink-0 text-ink tnum">
              {s.value.toLocaleString(intlLocale())}
            </span>
            <span className="w-9 shrink-0 text-right text-ink-subtle tnum">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── 租户 ↔ 知识库 二分图 ───────────── */

export interface GraphNode {
  id: number;
  name: string;
  /** 节点条的权重：租户用成员数、知识库用文档数 */
  weight: number;
  caption: string;
}

/**
 * 租户在左、知识库在右，连线就是「这个库归这个租户」。
 *
 * 之所以值得画成图而不是列表：真正要看见的是**没有连线的右节点**。
 * 实测这台机器上 9 个库有 4 个没绑租户，它们不通过租户成员关系可达，
 * 只能靠逐个按库授权 —— 这在任何一张表里都不显眼，在图里是几根悬空的条。
 *
 * 节点用 HTML、连线用 SVG：文字要跟着字号与主题走，还要能聚焦，
 * 放进 <text> 里这三件事都得手工重做一遍。
 */
export function BipartiteGraph({
  left,
  right,
  links,
}: {
  left: GraphNode[];
  right: GraphNode[];
  links: { from: number; to: number }[];
}) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const leftRefs = useRef(new Map<number, HTMLLIElement>());
  const rightRefs = useRef(new Map<number, HTMLLIElement>());
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [paths, setPaths] = useState<{ key: string; from: number; to: number; d: string }[]>(
    [],
  );
  const [focus, setFocus] = useState<number | null>(null);

  const measure = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setBox({ w: rect.width, h: rect.height });
    const midY = (node: HTMLElement | undefined) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return r.top - rect.top + r.height / 2;
    };
    const next: typeof paths = [];
    for (const l of links) {
      const a = midY(leftRefs.current.get(l.from));
      const b = midY(rightRefs.current.get(l.to));
      if (a == null || b == null) continue;
      const x1 = rect.width * 0.42;
      const x2 = rect.width * 0.58;
      // 三次贝塞尔而不是直线：两端各水平出发，多条线并行时才分得清谁连谁
      const bend = (x2 - x1) * 0.55;
      next.push({
        key: `${l.from}-${l.to}`,
        from: l.from,
        to: l.to,
        d: `M${x1},${a} C${x1 + bend},${a} ${x2 - bend},${b} ${x2},${b}`,
      });
    }
    setPaths(next);
  }, [links]);

  useLayoutEffect(() => {
    measure();
  }, [measure, left.length, right.length]);

  // 侧栏折叠、字体加载、窗口缩放都会改变节点纵向位置，必须重算连线
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const maxRight = Math.max(1, ...right.map((r) => r.weight));

  return (
    <div ref={wrap} className="relative grid grid-cols-2 gap-x-[16%]">
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        width={box.w || undefined}
        height={box.h || undefined}
      >
        {paths.map((p) => {
          const active = focus !== null && (p.from === focus || p.to === focus);
          const dim = focus !== null && !active;
          return (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              strokeWidth={active ? 2 : 1.25}
              className={`transition-opacity ${
                active ? TONE_STROKE.accent : "stroke-line-strong"
              } ${dim ? "opacity-20" : "opacity-100"}`}
            />
          );
        })}
      </svg>

      <ul className="space-y-1.5">
        {left.map((n) => (
          <li
            key={n.id}
            ref={(el) => {
              if (el) leftRefs.current.set(n.id, el);
              else leftRefs.current.delete(n.id);
            }}
          >
            <NodeBar
              node={n}
              align="right"
              dimmed={focus !== null && focus !== n.id}
              onEnter={() => setFocus(n.id)}
              onLeave={() => setFocus(null)}
              fillPct={null}
            />
          </li>
        ))}
        {!left.length && (
          <li className="py-6 text-right text-[11px] text-ink-subtle">
            {t("dash.graph.noTenants")}
          </li>
        )}
      </ul>

      <ul className="space-y-1.5">
        {right.map((n) => (
          <li
            key={n.id}
            ref={(el) => {
              if (el) rightRefs.current.set(n.id, el);
              else rightRefs.current.delete(n.id);
            }}
          >
            <NodeBar
              node={n}
              align="left"
              dimmed={focus !== null && focus !== n.id}
              onEnter={() => setFocus(n.id)}
              onLeave={() => setFocus(null)}
              fillPct={(n.weight / maxRight) * 100}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodeBar({
  node,
  align,
  dimmed,
  onEnter,
  onLeave,
  fillPct,
}: {
  node: GraphNode;
  align: "left" | "right";
  dimmed: boolean;
  onEnter: () => void;
  onLeave: () => void;
  /** null = 租户节点（不按权重画条，成员数直接写在副标题里） */
  fillPct: number | null;
}) {
  return (
    <div
      tabIndex={0}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      className={`rounded-[--radius-md] border bg-surface px-2.5 py-1.5 transition-opacity focus-visible:border-accent ${
        align === "right" ? "text-right" : "text-left"
      } ${dimmed ? "opacity-40" : "opacity-100"} ${
        fillPct === null ? "border-accent-border" : "border-line"
      }`}
    >
      <p className="truncate text-[--text-sm] text-ink">{node.name}</p>
      <p className="truncate text-[10px] text-ink-subtle tnum">{node.caption}</p>
      {fillPct !== null && (
        <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
          <span
            className="block h-full rounded-full bg-accent-soft"
            style={{ width: `${Math.max(fillPct, 3)}%` }}
          />
        </span>
      )}
    </div>
  );
}

/* ───────────── 就绪度灯 ───────────── */

/**
 * 服务与模型的就绪状态。
 *
 * 这一条是概览最该有、原来完全没有的东西：这台机器上「对话没反应」的真实原因
 * 是 .env 里的模型 id 和服务器上真正加载的模型对不上，而界面上没有任何地方能看出来。
 */
export function ReadinessList({
  items,
}: {
  items: { key: string; label: string; ok: boolean; note?: string }[];
}) {
  const { t } = useI18n();
  return (
    <ul className="divide-y divide-line-subtle">
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-2.5 py-1.5">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              it.ok ? "bg-success" : "bg-danger"
            }`}
          />
          <span className="min-w-0 flex-1 truncate text-[--text-sm] text-ink">
            {it.label}
          </span>
          <span
            className={`shrink-0 text-[11px] ${it.ok ? "text-ink-subtle" : "text-danger"}`}
          >
            {it.note ?? (it.ok ? t("dash.ready") : t("dash.notReady"))}
          </span>
        </li>
      ))}
    </ul>
  );
}
