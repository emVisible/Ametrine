// src/pages/Dashboard.tsx
// 概览回答三个问题：我能检索到什么、索引到什么程度、系统是否就绪。
//
// 上一版这里有四样东西被换掉了：
//  - 「开始」两张卡：侧栏已经指向 /chat 与 /rag，页头又有「开始检索」按钮，
//    同一屏三个地方指向同两个路由；
//  - 「最近会话」：侧栏本身就是可搜索的会话列表，这里再列五条是纯重复；
//  - 「今日 token」：读的是 user.daily_token_used，而全仓库没有任何地方写入这个字段，
//    于是它恒为 0，却以真实指标的样子摆在首屏；
//  - 「本地会话数」：localStorage 里的条数不是系统事实，换台浏览器就不一样了。
// 换成 /system/overview 聚合出来的真实读数，并且所有计数都带 scope 标注 ——
// 同一个数字在管理员和普通用户眼里含义不同，不能看不出来。
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useCurrentUser } from "../hooks/useAuth";
import { useSystemOverview } from "../hooks/queries";
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";
import OnboardingTour from "../components/OnboardingTour";
import {
  BarSeries,
  BipartiteGraph,
  ReadinessList,
  StackedBar,
  type GraphNode,
} from "../components/charts";
import { EmptyState, Panel, StatusBadge } from "../components/ui";
import {
  ClockIcon,
  DatabaseIcon,
  LayersIcon,
  LibraryIcon,
  SearchIcon,
  WarningIcon,
} from "../components/icons";

// 模块级：遮罩/Esc 关掉的引导在本次运行内不再打扰，刷新后才重新出现。
// 否则「切走再切回概览」会把刚被用户关掉的东西再糊脸一次。
const ONBOARDING_KEY = "ametrine_onboarding_done";
let tourHidden = false;

function Metric({
  label,
  value,
  unit,
  loading,
  to,
}: {
  label: string;
  value: number | null;
  unit?: string;
  loading?: boolean;
  /** 有落点就整块可点：概览上的数字应该能追到它对应的那个管理面 */
  to?: string;
}) {
  const { t } = useI18n();
  const body = (
    <>
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-1 flex items-baseline gap-1 text-[--text-2xl] font-semibold text-ink tnum">
        {loading ? (
          <span className="text-ink-subtle">—</span>
        ) : value == null ? (
          <span className="text-ink-subtle">{t("dash.notEnabled")}</span>
        ) : (
          <>
            {value.toLocaleString(intlLocale())}
            {unit && (
              <span className="text-[--text-sm] font-normal text-ink-subtle">
                {unit}
              </span>
            )}
          </>
        )}
      </p>
    </>
  );
  if (to)
    return (
      <Link
        to={to}
        className="a-card block px-4 py-3 transition-ui hover:border-accent-border hover:bg-surface-sunken"
      >
        {body}
      </Link>
    );
  return <div className="a-card px-4 py-3">{body}</div>;
}

export default function Dashboard() {
  const { data: user } = useCurrentUser();
  const { t } = useI18n();
  const { data: ov, isLoading, error, refetch } = useSystemOverview();
  // 惰性初始化即可，不需要在 effect 里回读 localStorage 再 setState
  const [tourOpen, setTourOpen] = useState(() => {
    if (tourHidden) return false;
    try {
      return !localStorage.getItem(ONBOARDING_KEY);
    } catch {
      return true; // 隐私模式读不到就按「还没看过」处理
    }
  });

  const hideOnboarding = () => {
    tourHidden = true;
    setTourOpen(false);
  };
  // 只有明确的「跳过」或走完最后一步才写永久标记：
  // 遮罩点击和 Esc 只是这次不看，误触不该让新用户永远失去引导
  const finishOnboarding = () => {
    tourHidden = true;
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      /* 隐私模式写不进去，本次会话内仍然生效 */
    }
    setTourOpen(false);
  };

  const today = new Date().toLocaleDateString(intlLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const graph = useMemo(() => {
    if (!ov) return { left: [] as GraphNode[], right: [] as GraphNode[], links: [] };
    const left: GraphNode[] = ov.composition.tenants.map((x) => ({
      id: x.id,
      name: x.name,
      weight: x.member_count,
      caption: t("dash.graph.tenantCaption", {
        members: x.member_count,
        dbs: x.databases.length,
      }),
    }));
    const seen = new Map<number, GraphNode>();
    const links: { from: number; to: number }[] = [];
    for (const tenant of ov.composition.tenants) {
      for (const db of tenant.databases) {
        if (!seen.has(db.id))
          seen.set(
            db.id,
            {
              id: db.id,
              name: db.name,
              weight: db.document_count,
              caption: t("dash.graph.dbCaption", {
                cols: db.collection_count,
                docs: db.document_count,
              }),
            },
          );
        links.push({ from: tenant.id, to: db.id });
      }
    }
    // 没绑租户的库也必须出现在右列：悬空的节点才是这张图要传达的信息
    for (const db of ov.composition.unbound_databases) {
      if (!seen.has(db.id))
        seen.set(
          db.id,
          {
            id: db.id,
            name: db.name,
            weight: db.document_count,
            caption: t("dash.graph.unboundCaption", {
              cols: db.collection_count,
              docs: db.document_count,
            }),
          },
        );
    }
    return { left, right: [...seen.values()], links };
  }, [ov, t]);

  const readiness = useMemo(() => {
    if (!ov) return [];
    const items: { key: string; label: string; ok: boolean; note?: string }[] = [
      {
        key: "postgres",
        label: t("dash.service.postgres"),
        ok: !!ov.services.postgres?.ok,
        note: ov.services.postgres?.ok ? undefined : ov.services.postgres?.detail ?? ov.services.postgres?.reason,
      },
      {
        key: "milvus",
        label: t("dash.service.milvus"),
        ok: !!ov.services.milvus?.ok,
        note: ov.services.milvus?.ok ? undefined : ov.services.milvus?.detail ?? ov.services.milvus?.reason,
      },
      {
        key: "redis",
        label: t("dash.service.redis"),
        ok: !!ov.services.redis?.ok,
        note: ov.services.redis?.ok ? undefined : ov.services.redis?.detail ?? ov.services.redis?.reason,
      },
    ];
    const m = ov.models;
    const roles: { key: "llm" | "embedding" | "rerank"; label: string }[] = [
      { key: "llm", label: t("dash.service.llm") },
      { key: "embedding", label: t("dash.service.embedding") },
      { key: "rerank", label: t("dash.service.rerank") },
    ];
    for (const role of roles) {
      const id = m.expected[role.key];
      if (!m.reachable) {
        items.push({
          key: role.key,
          label: `${role.label} · ${id}`,
          ok: false,
          note: m.detail ?? m.reason ?? t("dash.service.unreachable"),
        });
      } else if (m.missing.includes(role.key)) {
        // 服务器活着，但没有这个模型：这就是「聊天框转圈没结果」的真实原因
        items.push({
          key: role.key,
          label: `${role.label} · ${id}`,
          ok: false,
          note: t("dash.service.modelMissing"),
        });
      } else {
        items.push({ key: role.key, label: `${role.label} · ${id}`, ok: true });
      }
    }
    return items;
  }, [ov, t]);

  const blocked = readiness.filter((r) => !r.ok);

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      {tourOpen && (
        <OnboardingTour onHide={hideOnboarding} onFinish={finishOnboarding} />
      )}

      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[--text-2xl] font-semibold text-ink">
            {user?.name ? t("dash.welcome", { name: user.name }) : t("page.dashboard")}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[--text-sm] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon className="h-3.5 w-3.5" />
              {today}
            </span>
            {ov && (
              <StatusBadge tone={ov.scope === "all" ? "accent" : "neutral"}>
                {ov.scope === "all" ? t("dash.scopeAll") : t("dash.scopeGranted")}
              </StatusBadge>
            )}
          </p>
        </div>
        <Link to="/rag" className="a-btn a-btn-primary">
          <SearchIcon className="h-4 w-4" />
          {t("dash.startRetrieval")}
        </Link>
      </header>

      {error && (
        <div className="mb-4">
          <Panel
            title={t("dash.loadFailed")}
            actions={
              <button
                type="button"
                className="a-btn a-btn-outline !py-1 text-[11px]"
                onClick={() => refetch()}
              >
                {t("common.retry")}
              </button>
            }
          >
            <p className="px-4 py-3 text-[--text-sm] text-ink-muted">
              {error instanceof Error ? error.message : t("errors.unknown")}
            </p>
          </Panel>
        </div>
      )}

      {/* 有东西不通的时候，这一条必须在数字之前：读数本身没有意义，
          「为什么读数是零」才是用户要的答案。 */}
      {!isLoading && blocked.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[--radius-lg] border border-warning-border bg-warning-soft px-3.5 py-2.5">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[--text-sm] text-ink">
            {t("dash.blocked", { items: blocked.map((b) => b.label).join("、") })}
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label={t("dash.metric.databases")}
          value={ov?.knowledge.databases ?? null}
          loading={isLoading}
          to="/admin/vector"
        />
        <Metric
          label={t("dash.metric.collections")}
          value={ov?.knowledge.collections ?? null}
          loading={isLoading}
          to="/admin/vector"
        />
        <Metric
          label={t("dash.metric.documents")}
          value={ov?.knowledge.documents ?? null}
          loading={isLoading}
        />
        <Metric
          label={t("dash.metric.chunks")}
          value={ov?.knowledge.chunks ?? null}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={t("dash.indexHealth")}>
          <div className="px-4 py-3.5">
            {isLoading ? (
              <div className="space-y-2">
                <span className="skeleton block h-2.5 w-full rounded-full" />
                <span className="skeleton block h-3 w-2/3" />
              </div>
            ) : (
              ov && (
                <>
                  <StackedBar
                    segments={[
                      {
                        key: "indexed",
                        label: t("admin.vector.indexed"),
                        value: ov.knowledge.index.indexed,
                        tone: "success",
                      },
                      {
                        key: "pending",
                        label: t("admin.vector.pending"),
                        value: ov.knowledge.index.pending,
                        tone: "warning",
                      },
                      {
                        key: "failed",
                        label: t("admin.vector.indexFailed"),
                        value: ov.knowledge.index.failed,
                        tone: "danger",
                      },
                      {
                        key: "unknown",
                        label: t("dash.indexUnknown"),
                        value: ov.knowledge.index.unknown,
                        tone: "neutral",
                      },
                    ]}
                  />
                  {/* 空集合是「检索没结果」最普遍的原因，比索引失败更常见 */}
                  {ov.knowledge.empty_collections > 0 && (
                    <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-muted">
                      <WarningIcon className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                      {t("dash.emptyCollections", { n: ov.knowledge.empty_collections })}
                    </p>
                  )}
                </>
              )
            )}
          </div>
        </Panel>

        <Panel
          title={t("dash.ingestActivity")}
          description={
            ov && !ov.activity.some((a) => a.documents)
              ? t("dash.noRecentIngests", {
                  last: ov.last_ingested_at
                    ? ov.last_ingested_at.slice(0, 10)
                    : t("dash.never"),
                })
              : undefined
          }
        >
          <div className="px-4 py-3.5">
            {isLoading ? (
              <span className="skeleton block h-28 w-full" />
            ) : (
              ov && <BarSeries points={ov.activity} unit={t("dash.docUnit")} />
            )}
          </div>
        </Panel>

        <Panel
          title={t("dash.compositionGraph")}
          description={t("dash.compositionGraphDesc")}
        >
          <div className="px-4 py-3.5">
            {isLoading ? (
              <span className="skeleton block h-40 w-full" />
            ) : graph.left.length || graph.right.length ? (
              <BipartiteGraph left={graph.left} right={graph.right} links={graph.links} />
            ) : (
              <EmptyState
                icon={LibraryIcon}
                title={t("dash.noKb")}
                description={t("dash.noKbGraphDesc")}
              />
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title={t("dash.largestCollections")}>
            <div className="px-4 py-2.5">
              {isLoading ? (
                <span className="skeleton block h-20 w-full" />
              ) : !ov?.top_collections.length ? (
                <p className="py-3 text-[--text-sm] text-ink-subtle">{t("dash.noKb")}</p>
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {ov.top_collections.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2">
                      <LayersIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                      <span className="min-w-0 flex-1">
                        <Link
                          to={`/admin/vector/${c.database_id}/${c.id}`}
                          className="block truncate text-[--text-sm] text-ink hover:text-accent-ink hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="block truncate text-[10px] text-ink-subtle">
                          {c.database_name}
                        </span>
                      </span>
                      <span className="w-14 shrink-0">
                        <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
                          <span
                            className={`block h-full rounded-full ${
                              c.failed_count ? "bg-danger" : "bg-success"
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                (c.document_count
                                  ? (c.indexed_count / c.document_count) * 100
                                  : 0) || 3,
                              )}%`,
                            }}
                          />
                        </span>
                      </span>
                      <span className="w-16 shrink-0 text-right text-[11px] text-ink-muted tnum">
                        {t("dash.docsIndexed", {
                          docs: c.document_count,
                          indexed: c.indexed_count,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel title={t("dash.readiness")} description={t("dash.readinessDesc")}>
            <div className="px-4 py-2.5">
              {isLoading ? (
                <span className="skeleton block h-24 w-full" />
              ) : (
                <ReadinessList items={readiness} />
              )}
            </div>
          </Panel>
        </div>
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-ink-subtle">
        <DatabaseIcon className="h-3 w-3" />
        {t("dash.footerNote")}
      </p>
    </div>
  );
}
