// src/pages/AdminTenantDetail.tsx
// 租户子页面。
//
// 上一轮我把租户和成员融成了一个折叠列表，实测下来不对：
// 折叠带适合「扫一眼、改一下」，但一个租户真正要管的东西（成员及其角色、
// 绑定的知识库、每个成员的库级授权、配额）叠在两层展开里就变成了一堵墙，
// 既没有标题也没有可分享的地址。所以这里给租户一个独立页面，
// 成员与租户重新分成两个入口 —— 融合的是「同一件事不要有两个编辑口」，
// 不是「把所有东西塞进一个容器」。
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useConfirm } from "../hooks/useConfirm";
import { useI18n } from "../i18n/context";
import { useIsAdmin } from "../hooks/useAuth";
import {
  useKnowledgeIndex,
  useDeleteTenant,
  useSetGrant,
  useTenantOverview,
  useToggleMember,
  usePatchUser,
} from "../hooks/queries";
import {
  Breadcrumbs,
  Disclosure,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Panel,
  Select,
  StatusBadge,
} from "../components/ui";
import {
  BuildingIcon,
  ChevronRightIcon,
  DatabaseIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  WarningIcon,
} from "../components/icons";
import type { TenantOverview, TenantOverviewUser } from "../types/knowledge";
import { QuotaEditor } from "./adminAccessShared";
import { roleKeyOf, roleTone } from "../utils/roles";

const LEVEL_LABELS: Record<string, string> = {
  read: "admin.access.grantReadOnly",
  write: "admin.access.grantReadWrite",
  manage: "admin.access.grantManage",
};

function GrantControl({
  user,
  overview,
  tenantDbIds,
}: {
  user: TenantOverviewUser;
  overview: TenantOverview;
  /** 本租户绑定的库：这些库随成员身份即可读，不需要再挂单独授权 */
  tenantDbIds: Set<number>;
}) {
  const { t } = useI18n();
  const setGrant = useSetGrant();
  const mine = overview.grants.filter((g) => g.user_id === user.id);

  if (!overview.databases.length) {
    return (
      <Link to="/admin/vector" className="a-btn a-btn-outline !py-1 text-[11px]">
        {t("admin.access.goCreateDb")}
      </Link>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {overview.databases.map((db) => {
        const perm = mine.find((g) => g.database_id === db.id);
        const level = perm
          ? perm.can_manage
            ? "manage"
            : perm.can_write
              ? "write"
              : "read"
          : null;
        // 随租户可读的库标出来，避免管理员为了「他怎么读不到」再挂一条重复授权
        const viaTenant = tenantDbIds.has(db.id) && !level;
        return (
          <div key={db.id} className="flex overflow-hidden rounded-[--radius-md] border border-line">
            <span className="max-w-[9rem] truncate px-2 py-1 text-[11px] text-ink">
              {db.name}
              {viaTenant && (
                <span className="ml-1 text-ink-subtle">
                  {t("admin.access.viaTenant")}
                </span>
              )}
            </span>
            {/* 三个互斥按钮而不是下拉：读/写/管理是一眼可比的三档，
                而下拉要多一次点击、还会把当前级别藏起来。 */}
            {(["read", "write", "manage"] as const).map((lv) => (
              <button
                key={lv}
                type="button"
                aria-pressed={level === lv}
                disabled={setGrant.isPending}
                title={t(`admin.access.grantHint.${lv}`)}
                onClick={() =>
                  setGrant.mutate({
                    userId: user.id,
                    dbId: db.id,
                    level: level === lv ? null : lv,
                  })
                }
                className={`px-1.5 py-1 text-[10px] transition-ui ${
                  level === lv
                    ? "bg-accent text-ink-inverse"
                    : "bg-surface text-ink-subtle hover:bg-surface-hover"
                }`}
              >
                {t(LEVEL_LABELS[lv] ?? "common.unknown")}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 一个成员一行。
 *
 * 单独成组件是因为 usePatchUser 这类 hook 不能写在 members.map() 里 ——
 * 循环里的 hook 数量随数据长度变化，React 直接报 rules-of-hooks。
 */
function MemberRow({
  user,
  legacy,
  tenantId,
  overview,
  tenantDbIds,
  open,
  onToggle,
}: {
  user: TenantOverviewUser;
  legacy: boolean;
  tenantId: number;
  overview: TenantOverview;
  tenantDbIds: Set<number>;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const isAdmin = useIsAdmin();
  const patch = usePatchUser(user.id);
  const toggleMember = useToggleMember();
  const grantCount = overview.grants.filter((g) => g.user_id === user.id).length;

  return (
    <Disclosure
      level={1}
      open={open}
      onToggle={onToggle}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[9px] font-semibold text-ink-muted">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="truncate font-medium text-ink">{user.name}</span>
          {legacy && <StatusBadge tone="warning">{t("admin.access.legacyBadge")}</StatusBadge>}
          {!user.is_active && (
            <StatusBadge tone="danger">{t("common.disabled")}</StatusBadge>
          )}
        </span>
      }
      meta={
        <>
          <StatusBadge tone={roleTone(user.role_id)}>
            {t(roleKeyOf(user.role_id))}
          </StatusBadge>
          {grantCount > 0 && (
            <span className="tnum text-[11px] text-ink-subtle">
              {t("admin.access.grantCount", { n: grantCount })}
            </span>
          )}
        </>
      }
      actions={
        isAdmin && (
          <button
            type="button"
            className="a-btn a-btn-ghost !px-1.5 !py-1 text-[11px] text-danger"
            disabled={toggleMember.isPending}
            title={t("admin.access.remove")}
            onClick={() =>
              confirm({
                title: t("admin.access.removeMemberTitle", { name: user.name }),
                message: t("admin.access.removeMemberMsg"),
                confirmLabel: t("admin.access.remove"),
                tone: "danger",
              }).then(
                (ok) =>
                  ok &&
                  toggleMember.mutate({
                    tenantId,
                    userId: user.id,
                    join: false,
                  }),
              )
            }
          >
            <TrashIcon className="h-3.5 w-3.5" />
            <span className="sr-only">{t("admin.access.remove")}</span>
          </button>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-ink-muted">
            {t("common.role")}
          </span>
          <Select
            aria-label={`${t("admin.access.changeRole")} · ${user.name}`}
            value={user.role_id}
            className="!w-auto !py-1 text-[11px]"
            panelClassName="w-36"
            disabled={patch.isPending}
            options={[1, 2, 3].map((r) => ({ value: r, label: t(roleKeyOf(r)) }))}
            onChange={(v) => {
              const roleId = Number(v);
              if (roleId === user.role_id) return;
              confirm({
                title: t("admin.access.changeRoleTitle", {
                  name: user.name,
                  role: t(roleKeyOf(roleId)),
                }),
                message:
                  roleId === 3
                    ? t("admin.access.changeRoleAdminMsg")
                    : t("admin.access.changeRoleMsg"),
                confirmLabel: t("admin.access.confirmChange"),
                tone: "accent",
              }).then((ok) => ok && patch.mutate({ role_id: roleId }));
            }}
          />
        </div>

        <div className="border-t border-line-subtle pt-2.5">
          <p className="mb-1.5 text-[11px] font-medium text-ink-muted">
            {t("admin.access.quotaSection")}
          </p>
          <QuotaEditor
            user={user}
            disabled={patch.isPending}
            onSave={(body) => patch.mutate(body)}
          />
        </div>

        <div className="border-t border-line-subtle pt-2.5">
          <p className="mb-1.5 text-[11px] font-medium text-ink-muted">
            {t("admin.access.grantsSection")}
          </p>
          <GrantControl
            user={user}
            overview={overview}
            tenantDbIds={tenantDbIds}
          />
        </div>
      </div>
    </Disclosure>
  );
}

function MemberSection({
  tenantId,
  overview,
  tenantDbIds,
}: {
  tenantId: number;
  overview: TenantOverview;
  tenantDbIds: Set<number>;
}) {
  const { t } = useI18n();
  const isAdmin = useIsAdmin();
  const toggleMember = useToggleMember();
  const [pick, setPick] = useState<number | null>(null);
  const [openMembers, setOpenMembers] = useState<Set<number>>(new Set());

  const tenant = overview.tenants.find((x) => x.id === tenantId);
  const usersById = useMemo(
    () => new Map(overview.users.map((u) => [u.id, u])),
    [overview.users],
  );
  const members = tenant?.members ?? [];
  const inTenant = new Set(members.map((m) => m.user_id));
  const candidates = overview.users.filter((u) => !inTenant.has(u.id));

  const onToggle = (id: number) =>
    setOpenMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Panel
      title={t("admin.access.memberCount", {
        shown: members.length,
        total: overview.users.length,
      })}
      bodyClass="px-3 py-3"
      actions={
        isAdmin && (
          <div className="flex items-end gap-2">
            <Select
              aria-label={t("admin.access.addMember")}
              value={pick ?? ""}
              onChange={(v) => setPick(v === "" ? null : Number(v))}
              placeholder={t("admin.access.pickMember")}
              className="!w-44 !py-1 text-[11px]"
              panelClassName="w-56"
              options={[
                { value: "", label: t("admin.access.pickMember") },
                ...candidates.map((u) => ({
                  value: String(u.id),
                  label: u.name,
                })),
              ]}
            />
            <button
              type="button"
              className="a-btn a-btn-primary !py-1 text-[11px]"
              disabled={pick == null || toggleMember.isPending}
              onClick={() => {
                if (pick == null) return;
                toggleMember.mutate(
                  { tenantId, userId: pick, join: true },
                  { onSuccess: () => setPick(null) },
                );
              }}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {t("common.add")}
            </button>
          </div>
        )
      }
    >
      {!members.length ? (
        <p className="py-6 text-center text-[--text-sm] text-ink-subtle">
          {t("admin.access.tenantNoMembers")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => {
            const user = usersById.get(m.user_id);
            if (!user) return null;
            return (
              <MemberRow
                key={m.user_id}
                user={user}
                legacy={m.source === "legacy"}
                tenantId={tenantId}
                overview={overview}
                tenantDbIds={tenantDbIds}
                open={openMembers.has(m.user_id)}
                onToggle={() => onToggle(m.user_id)}
              />
            );
          })}
        </div>
      )}
    </Panel>
  );
}


export default function AdminTenantDetailPage() {
  const { t } = useI18n();
  const { tenantId } = useParams<{ tenantId: string }>();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const remove = useDeleteTenant();
  const id = Number(tenantId);
  const isAdmin = useIsAdmin();
  const { data: overview, isLoading, error, refetch } = useTenantOverview(isAdmin);
  const { databases, collectionsByDb, documentsByCollection } = useKnowledgeIndex();

  const tenant = overview?.tenants.find((x) => x.id === id);
  const tenantDbIds = useMemo(
    () => new Set(tenant?.database ? [tenant.database.id] : []),
    [tenant],
  );

  if (isLoading || !overview) {
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : <Loading />}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
        <PageHeader title={t("page.tenantDetail")} />
        <Panel>
          <EmptyState
            icon={ShieldIcon}
            title={t("admin.access.adminRequired")}
            description={t("admin.access.adminRequiredDesc")}
          />
        </Panel>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
        <PageHeader title={t("page.tenantDetail")} />
        <Panel>
          <EmptyState
            icon={BuildingIcon}
            title={t("admin.access.tenantMissing")}
            description={t("admin.access.tenantMissingDesc", { id: tenantId ?? "" })}
            action={
              <Link to="/admin/access?tab=tenants" className="a-btn a-btn-primary">
                {t("admin.access.backToTenants")}
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const bound = tenant.database
    ? databases.find((d) => d.id === tenant.database?.id)
    : undefined;
  const collections = bound ? (collectionsByDb.get(bound.id) ?? []) : [];
  const docTotal = collections.reduce(
    (s, c) => s + (documentsByCollection.get(c.id)?.length ?? 0),
    0,
  );

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      <PageHeader
        title={tenant.name}
        description={t("admin.access.tenantDetailDesc", {
          members: tenant.member_count,
          owners: tenant.owner_count,
        })}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: t("page.access"), to: "/admin/access" },
              { label: t("common.tenants"), to: "/admin/access?tab=tenants" },
              { label: tenant.name },
            ]}
          />
        }
        actions={
          <>
            <Link to="/admin/access?tab=tenants" className="a-btn a-btn-outline">
              {t("admin.access.backToTenants")}
            </Link>
            <button
              type="button"
              className="a-btn a-btn-danger"
              disabled={remove.isPending}
              onClick={() =>
                confirm({
                  title: t("admin.access.deleteTenantTitle", { name: tenant.name }),
                  message: tenant.member_count
                    ? t("admin.access.deleteTenantWithMembersMsg", {
                        n: tenant.member_count,
                      })
                    : t("admin.access.deleteTenantMsg"),
                  confirmLabel: t("admin.access.deleteTenantConfirm"),
                  tone: "danger",
                }).then(
                  (ok) =>
                    ok &&
                    remove.mutate(tenant.id, {
                      onSuccess: () => navigate("/admin/access?tab=tenants"),
                    }),
                )
              }
            >
              <TrashIcon className="h-4 w-4" />
              {t("common.del")}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* 左：这个租户的知识库。没有绑定就把「去建一个」摆在最显眼处，
            因为未绑定正是「成员读不到东西」的第一原因。 */}
        <div className="space-y-4">
          <Panel title={t("admin.access.boundDbHeader")}>
            <div className="px-4 py-3.5">
              {!tenant.database ? (
                <div className="flex items-start gap-2">
                  <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0">
                    <p className="text-[--text-sm] text-ink">
                      {t("admin.access.unboundDb")}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                      {t("admin.access.unboundDbDesc")}
                    </p>
                    <Link
                      to="/admin/vector"
                      className="a-btn a-btn-outline !py-1 text-[11px] mt-2"
                    >
                      {t("admin.access.goCreateDb")}
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <Link
                    to={`/admin/vector/${tenant.database.id}`}
                    className="flex items-center gap-2 text-[--text-sm] font-medium text-ink hover:text-accent-ink"
                  >
                    <DatabaseIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
                    {tenant.database.name}
                    <ChevronRightIcon className="h-3.5 w-3.5 text-ink-subtle" />
                  </Link>
                  <p className="mt-1.5 text-[11px] text-ink-subtle tnum">
                    {bound?.description || t("ui.noDescription")}
                  </p>
                  <div className="mt-3 flex gap-4 border-t border-line-subtle pt-2.5 text-[11px] text-ink-muted tnum">
                    <span>
                      {t("dash.metric.collections")}{" "}
                      <b className="text-ink">{tenant.database.collection_count}</b>
                    </span>
                    <span>
                      {t("dash.metric.documents")} <b className="text-ink">{docTotal}</b>
                    </span>
                  </div>

                  {collections.length > 0 && (
                    <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
                      {collections.map((c) => {
                        const docs = documentsByCollection.get(c.id) ?? [];
                        return (
                          <li key={c.id} className="min-w-0">
                            <Link
                              to={`/admin/vector/${tenant.database!.id}/${c.id}`}
                              className="flex items-baseline justify-between gap-1.5 rounded-[--radius-md] border border-line bg-surface px-2 py-1.5 transition-ui hover:border-accent-border hover:bg-surface-sunken"
                            >
                              <span className="min-w-0 truncate text-[11px] text-ink">
                                {c.name}
                              </span>
                              <span className="shrink-0 text-[10px] text-ink-subtle tnum">
                                {docs.length}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Panel>

          <Panel title={t("admin.access.tenantStats")}>
            <ul className="divide-y divide-line-subtle px-4 py-1.5">
              <li className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[11px] text-ink-muted">{t("common.tenant")}</span>
                <span className="text-[--text-sm] text-ink tnum">#{tenant.id}</span>
              </li>
              <li className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[11px] text-ink-muted">{t("common.members")}</span>
                <span className="text-[--text-sm] text-ink tnum">
                  {tenant.member_count}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 py-1.5">
                <span className="text-[11px] text-ink-muted">
                  {t("admin.access.legacyBadge")}
                </span>
                <span className="text-[--text-sm] text-ink tnum">
                  {tenant.members.filter((m) => m.source === "legacy").length}
                </span>
              </li>
            </ul>
          </Panel>
        </div>

        <MemberSection
          tenantId={tenant.id}
          overview={overview}
          tenantDbIds={tenantDbIds}
        />
      </div>

      <p className="mt-5 text-[11px] text-ink-subtle">
        {t("admin.access.tenantDetailFoot")}
      </p>
    </div>
  );
}
