// src/pages/AdminAccess.tsx
// 成员与租户是两个独立界面，各自负责一半的授权关系。
//
// 演进过程值得记下来，否则下一次又会被「融合」回去：
//  1. 最早是两套弹窗（成员行开带页签的弹窗、租户行开成员弹窗），同一个归属关系
//     有两个编辑口，且租户页签为算一个布尔值为每个租户各发一次请求；
//  2. 上一轮合并成一个折叠列表，实测不对 —— 折叠带适合扫一眼，
//     但一个租户真正要管的东西叠在两层展开里成了一堵墙，也没有可分享的地址；
//  3. 现在重新分开，并给租户一个独立子页面（/admin/tenants/:id）。
//
// 分开的同时保持「一条关系只有一个编辑口」：
//  - 随租户开放的库 → 只能在租户页授权（那是那个租户的事）；
//  - 没有绑定任何租户的库 → 只能在成员侧授权（没有别的归属方）；
//  - 成员归属（加入/移出）→ 只在租户页。
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useConfirm } from "../hooks/useConfirm";
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";
import { useIsAdmin } from "../hooks/useAuth";
import {
  useCreateTenant,
  usePatchUser,
  useSetGrant,
  useTenantOverview,
} from "../hooks/queries";
import {
  DataTable,
  EmptyState,
  ErrorState,
  InfoRow,
  Loading,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
  TextInput,
  type Column,
} from "../components/ui";
import {
  BuildingIcon,
  LibraryIcon,
  PlusIcon,
  ShieldIcon,
  UsersIcon,
} from "../components/icons";
import type { TenantOverview, TenantOverviewUser } from "../types/knowledge";
import { QuotaEditor } from "./adminAccessShared";
import { roleKeyOf, roleTone } from "../utils/roles";

function useOrphanDbIds(overview: TenantOverview | undefined) {
  return useMemo(() => {
    const bound = new Set(
      (overview?.tenants ?? []).flatMap((x) => (x.database ? [x.database.id] : [])),
    );
    return (overview?.databases ?? []).filter((d) => !bound.has(d.id)).map((d) => d.id);
  }, [overview]);
}

/* ───────────── 成员详情 ───────────── */

function MemberDetail({ user, overview, onClose }: {
  user: TenantOverviewUser;
  overview: TenantOverview;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const patch = usePatchUser(user.id);
  const setGrant = useSetGrant();
  const orphanIds = useOrphanDbIds(overview);
  const [tab, setTab] = useState<"info" | "grants" | "tenants">("info");

  const myGrants = overview.grants.filter((g) => g.user_id === user.id);
  const myTenants = overview.tenants.filter((x) =>
    x.members.some((m) => m.user_id === user.id),
  );
  const orphanDbs = overview.databases.filter((d) => orphanIds.includes(d.id));

  return (
    <Modal open onClose={onClose} title={user.name} width="max-w-lg">
      <Tabs
        ariaLabel={t("admin.access.detailTabs")}
        value={tab}
        onChange={setTab}
        items={[
          { key: "info", label: t("common.basicInfo") },
          {
            key: "grants",
            label: t("admin.access.tabGrants"),
            badge: myGrants.length,
          },
          {
            key: "tenants",
            label: t("admin.access.tabTenants"),
            badge: myTenants.length,
          },
        ]}
      />

      {tab === "info" && (
        <div className="divide-y divide-line-subtle">
          <InfoRow label={t("admin.access.userId")} value={user.id} />
          <InfoRow
            label={t("common.accountStatus")}
            value={
              user.is_active ? (
                <StatusBadge tone="success" dot>
                  {t("common.active")}
                </StatusBadge>
              ) : (
                <StatusBadge tone="danger">{t("common.disabled")}</StatusBadge>
              )
            }
          />
          <InfoRow
            label={t("common.lastLogin")}
            value={
              <span className="tnum">
                {user.last_login_at?.slice(0, 10) || t("common.neverLoggedIn")}
              </span>
            }
          />
          <InfoRow
            label={t("common.totalTokens")}
            value={
              <span className="tnum">
                {(user.total_token_used ?? 0).toLocaleString(intlLocale())}
              </span>
            }
          />
          <div className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-[--text-sm] text-ink-muted">{t("common.role")}</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={roleTone(user.role_id)}>
                {t(roleKeyOf(user.role_id))}
              </StatusBadge>
              <Select
                aria-label={t("admin.access.changeRole")}
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
          </div>
          <div className="pt-2.5">
            <p className="mb-1.5 text-[11px] font-medium text-ink-muted">
              {t("admin.access.quotaSection")}
            </p>
            <QuotaEditor
              user={user}
              disabled={patch.isPending}
              onSave={(body) => patch.mutate(body)}
            />
          </div>
        </div>
      )}

      {tab === "grants" && (
        <div>
          <p className="mb-2.5 text-[11px] leading-relaxed text-ink-muted">
            {t("admin.access.orphanGrantsHint")}
          </p>
          {!orphanDbs.length ? (
            <EmptyState
              icon={LibraryIcon}
              title={t("admin.access.allViaTenant")}
              description={t("admin.access.allViaTenantDesc")}
            />
          ) : (
            <ul className="divide-y divide-line-subtle">
              {orphanDbs.map((db) => {
                const perm = myGrants.find((g) => g.database_id === db.id);
                const level = perm
                  ? perm.can_manage
                    ? "manage"
                    : perm.can_write
                      ? "write"
                      : "read"
                  : null;
                return (
                  <li key={db.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[--text-sm] text-ink">{db.name}</p>
                      <p className="truncate text-[11px] text-ink-subtle tnum">
                        {t("admin.access.collectionCount", { n: db.collection_count })}
                      </p>
                    </div>
                    <div className="flex shrink-0 overflow-hidden rounded-[--radius-md] border border-line">
                      {(["read", "write", "manage"] as const).map((lv) => (
                        <button
                          key={lv}
                          type="button"
                          aria-pressed={level === lv}
                          disabled={setGrant.isPending}
                          onClick={() =>
                            setGrant.mutate({
                              userId: user.id,
                              dbId: db.id,
                              level: level === lv ? null : lv,
                            })
                          }
                          className={`px-2 py-1 text-[10px] transition-ui ${
                            level === lv
                              ? "bg-accent text-ink-inverse"
                              : "bg-surface text-ink-subtle hover:bg-surface-hover"
                          }`}
                        >
                          {t(`admin.access.grantLevel.${lv}`)}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "tenants" && (
        <div>
          {/* 只读：成员归属的唯一编辑口在租户页，这里给入口而不是第二个表单 */}
          <p className="mb-2.5 text-[11px] leading-relaxed text-ink-muted">
            {t("admin.access.tenantsReadonlyHint")}
          </p>
          {!myTenants.length ? (
            <EmptyState
              icon={BuildingIcon}
              title={t("admin.access.unassigned")}
              description={t("admin.access.unassignedDesc")}
            />
          ) : (
            <ul className="space-y-1.5">
              {myTenants.map((x) => (
                <li key={x.id}>
                  <Link
                    to={`/admin/tenants/${x.id}`}
                    onClick={onClose}
                    className="a-card flex items-center justify-between gap-3 px-3 py-2 transition-ui hover:border-accent-border"
                  >
                    <span className="min-w-0 truncate text-[--text-sm] text-ink">
                      {x.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-accent-ink">
                      {t("admin.access.openTenant")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───────────── 成员页签 ───────────── */

function MembersPanel({ overview }: { overview: TenantOverview }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [selected, setSelected] = useState<TenantOverviewUser | null>(null);

  const tenantNames = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const x of overview.tenants) {
      for (const mem of x.members) {
        m.set(mem.user_id, [...(m.get(mem.user_id) ?? []), x.name]);
      }
    }
    return m;
  }, [overview.tenants]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return overview.users
      .filter((u) => !roleFilter || String(u.role_id) === roleFilter)
      .filter(
        (u) =>
          !needle ||
          u.name.toLowerCase().includes(needle) ||
          (u.email ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, [overview.users, query, roleFilter]);

  const columns: Column<TenantOverviewUser>[] = [
    {
      key: "name",
      header: t("common.members"),
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[10px] font-semibold text-ink-muted">
            {u.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-medium text-ink">
              {u.name}
              {!u.is_active && (
                <StatusBadge tone="danger">{t("common.disabled")}</StatusBadge>
              )}
            </p>
            <p className="truncate text-[11px] text-ink-subtle">
              {u.email || t("nav.noEmail")}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: t("common.role"),
      width: "7rem",
      cell: (u) => (
        <StatusBadge tone={roleTone(u.role_id)}>{t(roleKeyOf(u.role_id))}</StatusBadge>
      ),
    },
    {
      key: "tenants",
      header: t("common.tenant"),
      width: "14rem",
      hideBelow: "md",
      cell: (u) => {
        const names = tenantNames.get(u.id) ?? [];
        if (!names.length)
          return <span className="text-[11px] text-ink-subtle">{t("admin.access.unassigned")}</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {names.map((n) => (
              <span key={n} className="a-badge border-line bg-surface-sunken text-ink-muted">
                {n}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      key: "lastLogin",
      header: t("common.lastLogin"),
      width: "9rem",
      hideBelow: "md",
      cell: (u) => (
        <span className="tnum text-ink-subtle">
          {u.last_login_at?.slice(0, 10) || t("common.neverLoggedIn")}
        </span>
      ),
    },
    {
      key: "tokens",
      header: t("common.totalTokens"),
      align: "right",
      width: "8rem",
      hideBelow: "sm",
      cell: (u) => (
        <span className="tnum text-ink-muted">
          {(u.total_token_used ?? 0).toLocaleString(intlLocale())}
        </span>
      ),
    },
  ];

  return (
    <>
      <Panel
        bodyClass="px-4 py-3"
        title={t("admin.access.memberTotal", { n: overview.users.length })}
        actions={
          <>
            <Select
              aria-label={t("admin.access.filterByRole")}
              value={roleFilter}
              onChange={(v) => setRoleFilter(String(v))}
              className="!w-auto !py-1 text-[11px]"
              panelClassName="w-36"
              placeholder={t("admin.access.allRoles")}
              options={[
                { value: "", label: t("admin.access.allRoles") },
                ...[1, 2, 3].map((r) => ({ value: String(r), label: t(roleKeyOf(r)) })),
              ]}
            />
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder={t("admin.access.searchMembers")}
              className="w-52"
            />
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          onRowClick={setSelected}
          empty={
            <EmptyState
              icon={UsersIcon}
              title={
                query || roleFilter
                  ? t("admin.access.noMemberMatch")
                  : t("admin.access.noMembers")
              }
              description={
                query || roleFilter
                  ? t("admin.access.memberSearchHint")
                  : t("admin.access.noMembersDesc")
              }
            />
          }
        />
      </Panel>

      {selected && (
        <MemberDetail
          user={selected}
          overview={overview}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

/* ───────────── 租户页签 ───────────── */

function TenantsPanel({
  overview,
  onCreate,
}: {
  overview: TenantOverview;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  // 删除租户挪到了租户子页面：卡片这一层是「挑一个进去」，
  // 破坏性动作不该和选择动作挤在同一个点击面上。
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return overview.tenants
      .filter(
        (x) =>
          !needle ||
          x.name.toLowerCase().includes(needle) ||
          (x.database?.name.toLowerCase().includes(needle) ?? false) ||
          x.members.some((m) => m.name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, [overview.tenants, query]);

  return (
    <Panel
      bodyClass="px-3 py-3"
      title={t("admin.access.tenantCount", { n: overview.tenants.length })}
      actions={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("admin.access.searchTenants")}
          className="w-52"
        />
      }
    >
      {!rows.length ? (
        <EmptyState
          icon={BuildingIcon}
          title={query ? t("admin.access.noTenantMatch") : t("admin.access.noTenant")}
          description={query ? t("common.tryKeyword") : t("admin.access.noTenantDesc")}
          action={
            query ? undefined : (
              <button type="button" className="a-btn a-btn-primary" onClick={onCreate}>
                <PlusIcon className="h-4 w-4" />
                {t("admin.access.newTenant")}
              </button>
            )
          }
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
          {rows.map((x) => (
            <li key={x.id} className="min-w-0">
              <Link
                to={`/admin/tenants/${x.id}`}
                className="a-card flex h-full flex-col gap-1.5 px-3 py-2.5 transition-ui hover:border-accent-border hover:bg-surface-sunken"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <BuildingIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {x.name}
                  </span>
                  {!x.database && (
                    <StatusBadge tone="warning">{t("admin.access.unboundDb")}</StatusBadge>
                  )}
                </span>
                <span className="flex flex-wrap items-baseline gap-x-3 text-[11px] text-ink-subtle tnum">
                  <span>{t("admin.access.memberShort", { n: x.member_count })}</span>
                  {x.database && (
                    <span className="min-w-0 truncate">
                      {x.database.name} ·{" "}
                      {t("admin.access.collectionCount", {
                        n: x.database.collection_count,
                      })}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────── 页面 ───────────── */

export default function AdminAccessPage() {
  const { t } = useI18n();
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "tenants" ? "tenants" : "members";
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const { data: overview, isLoading, error, refetch } = useTenantOverview(isAdmin);
  const create = useCreateTenant();

  if (!isLoading && !isAdmin) {
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
        <PageHeader title={t("page.access")} />
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

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      <PageHeader
        title={t("page.access")}
        description={t("admin.access.pageDesc")}
        actions={
          <button
            type="button"
            className="a-btn a-btn-primary"
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-4 w-4" />
            {t("admin.access.newTenant")}
          </button>
        }
      />

      <Tabs
        ariaLabel={t("page.access")}
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        items={[
          {
            key: "members",
            label: t("common.members"),
            badge: overview?.users.length ?? 0,
          },
          {
            key: "tenants",
            label: t("common.tenants"),
            badge: overview?.tenants.length ?? 0,
          },
        ]}
      />

      {isLoading ? (
        <Loading />
      ) : error ? (
        <Panel>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Panel>
      ) : overview && (
        <>
          {tab === "members" && <MembersPanel overview={overview} />}
          {tab === "tenants" && (
            <TenantsPanel overview={overview} onCreate={() => setCreating(true)} />
          )}
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t("admin.access.newTenant")}
        description={t("admin.access.newTenantDesc")}
        footer={
          <>
            <button
              type="button"
              className="a-btn a-btn-ghost"
              onClick={() => setCreating(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="a-btn a-btn-primary"
              disabled={create.isPending || !name.trim()}
              onClick={() =>
                create.mutate(
                  { name: name.trim() },
                  {
                    onSuccess: () => {
                      setCreating(false);
                      setName("");
                    },
                  },
                )
              }
            >
              {create.isPending ? t("common.creating") : t("common.create")}
            </button>
          </>
        }
      >
        <TextInput
          label={t("admin.access.tenantName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("admin.access.tenantNameExample")}
          autoFocus
        />
      </Modal>
    </div>
  );
}
