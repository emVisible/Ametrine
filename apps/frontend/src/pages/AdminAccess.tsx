// src/pages/AdminAccess.tsx
// 租户与成员原本是两套容器：成员行点开一个带三页签的弹窗，租户行点开另一个成员弹窗，
// 而「谁属于哪个租户」在两边各编辑一次 —— 同一个关系有两个入口、两种形状，
// 且租户页签里为了算一个「是否已加入」的布尔值，会为每个租户再发一次成员请求。
// 这里合成一个折叠列表：租户是一行，展开即见它的成员、绑定知识库与每个人的授权，
// 容器范式只剩 Disclosure 一种，数据只剩 /relation/tenant/overview 一次请求。
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useConfirm } from "../hooks/useConfirm";
import { useCurrentUser } from "../hooks/useAuth";
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";
import {
  useCreateTenant,
  useDeleteTenant,
  usePatchUser,
  useTenantOverview,
  useToggleGrant,
  useToggleMember,
} from "../hooks/queries";
import {
  Disclosure,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  StatusBadge,
  TextInput,
} from "../components/ui";
import {
  BuildingIcon,
  ChevronDownIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon,
} from "../components/icons";
import type { TenantOverview, TenantOverviewUser } from "../types/knowledge";

/** 存文案键而不是文案：模块级常量存译文的话，切语言后仍然是旧语言 */
const ROLE_KEYS: Record<number, string> = {
  1: "common.roleUser",
  2: "common.roleManager",
  3: "common.roleAdmin",
};

/** 索引访问的类型是 string | undefined，统一在这里兜到「未知」的文案键 */
function roleKeyOf(roleId: number) {
  return ROLE_KEYS[roleId] ?? "common.unknown";
}

// 只有管理员值得用强调色，其余角色保持中性：
// 一屏里出现多个彩色徽章时，颜色就不再传递信息了。
function roleTone(roleId: number) {
  return roleId === 3 ? ("accent" as const) : ("neutral" as const);
}

/**
 * 展开状态是一个扁平的 key 集合，而不是「租户开没开」「成员开没开」两个 state：
 * 搜索命中要连带展开父级，两个 state 就得互相猜对方的层级。
 */
const tenantKey = (id: number) => `t:${id}`;
const memberKey = (tenantId: number, userId: number) => `m:${tenantId}:${userId}`;

/* ───────────── 配额（管理员侧） ───────────── */

/**
 * 配额从「系统设置 → 用量配额」搬到这里：那是每个账号自己的页面，
 * 把上限按钮放在那儿等于让用户自己改自己的配额。
 * 只发 limit；用量由后端统计，目前 daily/monthly 两个字段还没有写入方（写在文案里）。
 */
function QuotaEditor({
  user,
  disabled,
  onSave,
}: {
  user: TenantOverviewUser;
  disabled: boolean;
  onSave: (body: Record<string, number>) => void;
}) {
  const { t } = useI18n();
  const rows = [
    {
      field: "daily_token_limit",
      title: t("settings.dailyLimit"),
      used: user.daily_token_used ?? 0,
      current: user.daily_token_limit ?? 100_000,
      options: [50_000, 100_000, 200_000, 500_000],
    },
    {
      field: "monthly_token_limit",
      title: t("settings.monthlyLimit"),
      used: user.monthly_token_used ?? 0,
      current: user.monthly_token_limit ?? 3_000_000,
      options: [1_000_000, 3_000_000, 5_000_000, 10_000_000],
    },
  ];

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {rows.map((row) => (
        <div key={row.field} className="min-w-[13rem] flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-muted">{row.title}</span>
            <Select
              aria-label={`${row.title} · ${user.name}`}
              value={row.current}
              className="!w-auto !py-1 text-[11px]"
              disabled={disabled}
              options={row.options.map((v) => ({
                value: v,
                label: v.toLocaleString(intlLocale()),
              }))}
              onChange={(v) => {
                const next = Number(v);
                if (next === row.current) return;
                onSave({ [row.field]: next });
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-subtle tnum">
            {t("settings.quotaUsed", {
              used: row.used.toLocaleString(intlLocale()),
              limit: row.current.toLocaleString(intlLocale()),
            })}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ───────────── 成员行 ───────────── */

function MemberRow({
  user,
  tenantId,
  overview,
  open,
  onToggle,
  forcedOpen,
}: {
  user: TenantOverviewUser;
  /** 从「未分配」分组里渲染时传 null：那里没有「随租户可读」的库可标注 */
  tenantId: number | null;
  overview: TenantOverview;
  open: boolean;
  onToggle: () => void;
  /** 搜索命中时代码上展开，但视觉上不该显示成用户手动点开 */
  forcedOpen: boolean;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const patch = usePatchUser(user.id);
  const toggleMember = useToggleMember();
  const grants = useToggleGrant();
  const [pendingRole, setPendingRole] = useState<number | null>(null);

  const myGrants = overview.grants.filter((g) => g.user_id === user.id);
  const tenantDbIds = new Set(
    tenantId == null
      ? []
      : overview.tenants
          .filter((x) => x.id === tenantId)
          .flatMap((x) => (x.database ? [x.database.id] : [])),
  );

  return (
    <Disclosure
      level={1}
      open={open || forcedOpen}
      onToggle={onToggle}
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[9px] font-semibold text-ink-muted">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="truncate font-medium text-ink">{user.name}</span>
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
          {myGrants.length > 0 && (
            <span className="tnum text-[11px] text-ink-subtle">
              {t("admin.access.grantCount", { n: myGrants.length })}
            </span>
          )}
        </>
      }
      actions={
        tenantId != null && (
          <button
            type="button"
            className="a-btn a-btn-ghost !py-1 text-[11px] text-danger"
            disabled={toggleMember.isPending}
            onClick={() =>
              confirm({
                title: t("admin.access.removeMemberTitle", {
                  name: user.name,
                }),
                message: t("admin.access.removeMemberMsg"),
                confirmLabel: t("admin.access.remove"),
                tone: "danger",
              }).then((ok) =>
                ok &&
                toggleMember.mutate({
                  tenantId: tenantId,
                  userId: user.id,
                  join: false,
                }),
              )
            }
          >
            {t("admin.access.remove")}
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
            value={pendingRole ?? user.role_id}
            className="!w-auto !py-1 text-[11px]"
            panelClassName="w-36"
            disabled={patch.isPending}
            options={[1, 2, 3].map((roleId) => ({
              value: roleId,
              label: t(roleKeyOf(roleId)),
            }))}
            onChange={(v) => {
              const roleId = Number(v);
              setPendingRole(roleId);
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
              }).then((ok) => {
                setPendingRole(null);
                if (ok) patch.mutate({ role_id: roleId });
              });
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
          {!overview.databases.length ? (
            <Link to="/admin/vector" className="a-btn a-btn-outline !py-1 text-[11px]">
              {t("admin.access.goCreateDb")}
            </Link>
          ) : (
            <>
              <ul className="flex flex-wrap gap-1.5">
                {overview.databases.map((db) => {
                  const perm = myGrants.find((g) => g.database_id === db.id);
                  const granted = !!perm;
                  // 本租户绑定的库：成员身份已经给了读权限，再单独挂一条就是重复记录
                  const viaTenant = tenantDbIds.has(db.id);
                  return (
                    <li key={db.id}>
                      <button
                        type="button"
                        aria-pressed={granted}
                        disabled={grants.isPending}
                        onClick={() =>
                          grants.mutate({ userId: user.id, dbId: db.id, on: !granted })
                        }
                        className={`a-btn !py-1 text-[11px] ${
                          granted ? "a-btn-primary" : "a-btn-outline"
                        }`}
                        title={
                          viaTenant && !granted
                            ? t("admin.access.grantViaTenantHint")
                            : granted
                              ? t("admin.access.revoke")
                              : t("admin.access.grant")
                        }
                      >
                        {db.name}
                        {granted && (
                          <span className="ml-1 opacity-80">
                            {perm?.can_write
                              ? t("admin.access.grantReadWrite")
                              : t("admin.access.grantReadOnly")}
                          </span>
                        )}
                        {!granted && viaTenant && (
                          <span className="ml-1 text-ink-subtle">
                            {t("admin.access.viaTenant")}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
                {t("admin.access.grantsHint")}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-subtle pt-2.5 text-[11px] text-ink-subtle tnum">
          <span>
            {t("common.lastLogin")}：
            {user.last_login_at?.slice(0, 10) || t("common.neverLoggedIn")}
          </span>
          <span>
            {t("common.totalTokens")}：
            {(user.total_token_used ?? 0).toLocaleString(intlLocale())}
          </span>
          {user.email && <span className="truncate">{user.email}</span>}
        </div>
      </div>
    </Disclosure>
  );
}

/* ───────────── 租户行 ───────────── */

function AddMemberInline({
  tenantId,
  overview,
}: {
  tenantId: number;
  overview: TenantOverview;
}) {
  const { t } = useI18n();
  const toggleMember = useToggleMember();
  const [pick, setPick] = useState<number | null>(null);

  const inTenant = new Set(
    overview.tenants.find((x) => x.id === tenantId)?.members.map((m) => m.user_id) ??
      [],
  );
  const candidates = overview.users.filter((u) => !inTenant.has(u.id));

  if (!candidates.length) return null;

  return (
    <div className="mt-2.5 flex items-end gap-2 border-t border-line-subtle pt-2.5">
      <div className="min-w-0 flex-1">
        <Select
          label={t("admin.access.addMember")}
          value={pick ?? ""}
          onChange={(v) => setPick(v === "" ? null : Number(v))}
          placeholder={t("admin.access.pickMember")}
          options={[
            { value: "", label: t("admin.access.pickMember") },
            ...candidates.map((u) => ({
              value: String(u.id),
              label: u.email ? `${u.name} · ${u.email}` : u.name,
            })),
          ]}
        />
      </div>
      <button
        type="button"
        className="a-btn a-btn-primary !py-1.5 text-[11px]"
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
  );
}

function TenantSection({
  tenant,
  overview,
  isOpen,
  onToggle,
  searching,
  onDelete,
}: {
  tenant: TenantOverview["tenants"][number];
  overview: TenantOverview;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  searching: boolean;
  onDelete: (tenant: TenantOverview["tenants"][number]) => void;
}) {
  const { t } = useI18n();
  const usersById = useMemo(
    () => new Map(overview.users.map((u) => [u.id, u])),
    [overview.users],
  );
  const open = isOpen(tenantKey(tenant.id));

  // 只有 TenantMember 之外的旧口径归属值得单独提示：它们不会随「移出」一起消失，
  // 不写出来的话界面看起来就是「有成员但没人可管」。
  const legacy = tenant.members.filter((m) => m.source === "legacy");

  return (
    <Disclosure
      open={open}
      onToggle={() => onToggle(tenantKey(tenant.id))}
      title={
        <span className="flex items-center gap-2">
          <BuildingIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span className="truncate font-medium text-ink">{tenant.name}</span>
        </span>
      }
      meta={
        <>
          <span className="tnum text-[11px] text-ink-subtle">
            {t("admin.access.memberCount", {
              shown: tenant.member_count,
              total: tenant.member_count,
            })}
          </span>
          {tenant.database ? (
            <Link
              to={`/admin/vector/${tenant.database.id}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-[11px] text-accent-ink hover:underline"
            >
              {tenant.database.name}
              <span className="ml-1 text-ink-subtle tnum">
                {t("admin.access.collectionCount", {
                  n: tenant.database.collection_count,
                })}
              </span>
            </Link>
          ) : (
            <StatusBadge tone="warning">{t("admin.access.unboundDb")}</StatusBadge>
          )}
        </>
      }
      actions={
        <button
          type="button"
          className="a-btn a-btn-ghost !px-1.5 !py-1 text-[11px] text-danger"
          title={t("admin.access.deleteTenantTitle", { name: tenant.name })}
          onClick={() => onDelete(tenant)}
        >
          <TrashIcon className="h-3.5 w-3.5" />
          <span className="sr-only">{t("common.del")}</span>
        </button>
      }
    >
      {!tenant.members.length ? (
        <p className="py-2 text-[--text-sm] text-ink-subtle">
          {t("admin.access.tenantNoMembers")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tenant.members.map((m) => {
            const user = usersById.get(m.user_id);
            if (!user) return null;
            return (
              <li key={m.user_id}>
                <MemberRow
                  user={user}
                  tenantId={tenant.id}
                  overview={overview}
                  open={isOpen(memberKey(tenant.id, m.user_id))}
                  onToggle={() => onToggle(memberKey(tenant.id, m.user_id))}
                  forcedOpen={searching}
                />
              </li>
            );
          })}
        </ul>
      )}

      {legacy.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-subtle">
          <ShieldIcon className="mt-0.5 h-3 w-3 shrink-0" />
          {t("admin.access.legacyMembersNote", {
            names: legacy.map((m) => m.name).join("、"),
          })}
        </p>
      )}

      <AddMemberInline tenantId={tenant.id} overview={overview} />
    </Disclosure>
  );
}

/* ───────────── 页面 ───────────── */

export default function AdminAccessPage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { data: me } = useCurrentUser();
  const isAdmin = !!me?.permissions?.includes("admin");
  const { data: overview, isLoading, error, refetch } = useTenantOverview(isAdmin);
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateTenant();
  const remove = useDeleteTenant();

  const isOpen = (key: string) => openKeys.has(key);
  const onToggle = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const needle = query.trim().toLowerCase();
  const searching = needle !== "";

  const { tenantRows, unassigned } = useMemo(() => {
    const tenants = overview?.tenants ?? [];
    const byId = new Map(overview?.users.map((u) => [u.id, u]) ?? []);
    const affiliated = new Set<number>();
    const keep = new Set<number>();
    for (const tenant of tenants) {
      for (const m of tenant.members) affiliated.add(m.user_id);
      const hit =
        !searching ||
        tenant.name.toLowerCase().includes(needle) ||
        (tenant.database?.name.toLowerCase().includes(needle) ?? false) ||
        tenant.members.some(
          (m) =>
            m.name.toLowerCase().includes(needle) ||
            (byId.get(m.user_id)?.email ?? "").toLowerCase().includes(needle),
        );
      if (hit) keep.add(tenant.id);
    }
    return {
      tenantRows: tenants.filter((x) => keep.has(x.id)),
      // 「未分配」不参与搜索：它的判据是「不属于任何租户」，
      // 搜索时如果照常显示，同一个人会在命中租户和这里各出现一次。
      unassigned: searching
        ? []
        : (overview?.users ?? []).filter((u) => !affiliated.has(u.id)),
    };
  }, [overview, needle, searching]);

  const askDeleteTenant = (tenant: TenantOverview["tenants"][number]) =>
    confirm({
      title: t("admin.access.deleteTenantTitle", { name: tenant.name }),
      message: tenant.member_count
        ? t("admin.access.deleteTenantWithMembersMsg", { n: tenant.member_count })
        : t("admin.access.deleteTenantMsg"),
      confirmLabel: t("admin.access.deleteTenantConfirm"),
    }).then((ok) => ok && remove.mutate(tenant.id));

  if (!me) return null;

  if (!isAdmin) {
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

  const allKeys = overview
    ? overview.tenants.map((x) => tenantKey(x.id))
    : [];
  const everyOpen = allKeys.length > 0 && allKeys.every((k) => openKeys.has(k));

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

      {overview && (
        <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-subtle tnum">
          <span>{t("admin.access.statTenants", { n: overview.tenants.length })}</span>
          <span>{t("admin.access.statMembers", { n: overview.users.length })}</span>
          <span>{t("admin.access.statDatabases", { n: overview.databases.length })}</span>
          <span>{t("admin.access.statCollections", { n: overview.databases.reduce((s, d) => s + d.collection_count, 0) })}</span>
        </p>
      )}

      <Panel bodyClass="px-3 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("admin.access.searchAll")}
            className="w-full max-w-xs"
          />
          <button
            type="button"
            className="a-btn a-btn-ghost !py-1 text-[11px]"
            disabled={!allKeys.length}
            onClick={() =>
              setOpenKeys(everyOpen ? new Set<string>() : new Set(allKeys))
            }
          >
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-ui ${everyOpen ? "rotate-180" : ""}`}
            />
            {everyOpen ? t("admin.access.collapseAll") : t("admin.access.expandAll")}
          </button>
          {searching && (
            <span className="text-[11px] text-ink-subtle tnum">
              {t("admin.access.matchCount", { n: tenantRows.length })}
            </span>
          )}
        </div>

        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !overview || !overview.tenants.length ? (
          <EmptyState
            icon={BuildingIcon}
            title={searching ? t("admin.access.noTenantMatch") : t("admin.access.noTenant")}
            description={
              searching ? t("common.tryKeyword") : t("admin.access.noTenantDesc")
            }
            action={
              searching ? undefined : (
                <button
                  type="button"
                  className="a-btn a-btn-primary"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon className="h-4 w-4" />
                  {t("admin.access.newTenant")}
                </button>
              )
            }
          />
        ) : (
          <div className="space-y-2">
            {tenantRows.map((tenant) => (
              <TenantSection
                key={tenant.id}
                tenant={tenant}
                overview={overview}
                isOpen={isOpen}
                onToggle={onToggle}
                searching={searching}
                onDelete={askDeleteTenant}
              />
            ))}

            {/* 「未分配」是列表末尾的一个伪租户：它让「这个人还进不去任何库」
                在同一个容器里可见，而不是散落在两个页签之间。 */}
            {unassigned.length > 0 && (
              <Disclosure
                open={isOpen(tenantKey(-1))}
                onToggle={() => onToggle(tenantKey(-1))}
                title={
                  <span className="flex items-center gap-2">
                    <UserIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
                    <span className="truncate font-medium text-ink">
                      {t("admin.access.unassigned")}
                    </span>
                  </span>
                }
                meta={
                  <span className="tnum text-[11px] text-ink-subtle">
                    {t("admin.access.memberCount", {
                      shown: unassigned.length,
                      total: unassigned.length,
                    })}
                  </span>
                }
              >
                <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                  {t("admin.access.unassignedDesc")}
                </p>
                <ul className="space-y-1.5">
                  {unassigned.map((u) => (
                    <li key={u.id}>
                      <MemberRow
                        user={u}
                        tenantId={null}
                        overview={overview}
                        open={isOpen(memberKey(-1, u.id))}
                        onToggle={() => onToggle(memberKey(-1, u.id))}
                        forcedOpen={false}
                      />
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}

            {searching && !tenantRows.length && (
              <p className="py-6 text-center text-[--text-sm] text-ink-subtle">
                {t("admin.access.noMemberMatch")}
              </p>
            )}
          </div>
        )}
      </Panel>

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
