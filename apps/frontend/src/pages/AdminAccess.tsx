// src/pages/AdminAccess.tsx
// 成员、租户、知识库授权原本是三个割裂的界面（用户管理 / 租户 / 用户详情里的权限页签），
// 但它们回答的是同一个问题：谁能检索到什么。这里合成一个「组织与权限」。
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "../hooks/useConfirm";
import { Link } from "react-router";
import { apiClient } from "../api/client";
import { tenantAPI } from "../api/tenant";
import { useToast } from "../hooks/useToast";
import { useCurrentUser } from "../hooks/useAuth";
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";
import {
  qk,
  useCreateTenant,
  useDatabases,
  useDeleteTenant,
  useTenantMembers,
  useTenants,
  useUserPermissions,
  useUsers,
} from "../hooks/queries";
import {
  DataTable,
  EmptyState,
  InfoRow,
  Modal,
  PageHeader,
  Pagination,
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
import type { Tenant } from "../types/knowledge";
import type { User } from "../types/user";
import { paginate } from "../utils/pagination";

/** 存文案键而不是文案：模块级常量存译文的话，切语言后这张表仍然是旧语言 */
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

/* ───────────── 成员详情 ───────────── */

function TenantMembershipList({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();
  const { data: tenants } = useTenants();

  const toggle = useMutation({
    mutationFn: (vars: { tenantId: number; join: boolean }) =>
      vars.join
        ? tenantAPI.addMember(vars.tenantId, user.id)
        : tenantAPI.removeMember(vars.tenantId, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access"] });
      toast(t("admin.access.tenantsUpdated"), "success");
    },
    onError: (e: Error) =>
      toast(t("admin.access.changeFailed", { msg: e.message }), "error"),
  });

  if (!tenants?.length)
    return (
      <EmptyState
        icon={BuildingIcon}
        title={t("admin.access.noTenant")}
        description={t("admin.access.noTenantInMember")}
      />
    );

  return (
    <ul className="divide-y divide-line-subtle">
      {tenants.map((tenant) => (
        <TenantMemberRow
          key={tenant.id}
          tenant={tenant}
          userId={user.id}
          busy={toggle.isPending}
          onToggle={(join) => toggle.mutate({ tenantId: tenant.id, join })}
        />
      ))}
    </ul>
  );
}

function TenantMemberRow({
  tenant,
  userId,
  busy,
  onToggle,
}: {
  tenant: Tenant;
  userId: number;
  busy: boolean;
  onToggle: (join: boolean) => void;
}) {
  const { t } = useI18n();
  const { data: members, isLoading } = useTenantMembers(tenant.id);
  const joined = !!members?.some((m) => m.user_id === userId);

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[--text-sm] text-ink">{tenant.name}</p>
        {tenant.database && (
          <p className="truncate text-[11px] text-ink-subtle">
            {t("admin.access.boundDb", { db: tenant.database })}
          </p>
        )}
      </div>
      {isLoading ? (
        <span className="text-[11px] text-ink-subtle">{t("common.loading")}</span>
      ) : (
        joined && <StatusBadge tone="accent">{t("admin.access.memberBadge")}</StatusBadge>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(!joined)}
        className={`a-btn !py-1 text-[11px] ${joined ? "a-btn-danger" : "a-btn-outline"}`}
      >
        {joined ? t("admin.access.remove") : t("admin.access.join")}
      </button>
    </li>
  );
}

/**
 * 管理员侧的配额编辑。
 *
 * 配额从「系统设置 → 用量配额」搬到这里：那是每个账号自己的页面，
 * 把上限按钮放在那儿等于让用户自己改自己的配额（后端 PATCH 当时只挡了 role_id）。
 * 只发 limit；用量由后端统计，目前还没接上（设置页已把这点写在脸上）。
 */
function QuotaEditor({
  user,
  disabled,
  onSave,
}: {
  user: User;
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
    <div className="divide-y divide-line-subtle">
      {rows.map((row) => (
        <div
          key={row.field}
          className="flex flex-wrap items-center justify-between gap-2 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-[--text-sm] text-ink">{row.title}</p>
            <p className="text-[11px] text-ink-subtle tnum">
              {t("settings.quotaUsed", {
                used: row.used.toLocaleString(intlLocale()),
                limit: row.current.toLocaleString(intlLocale()),
              })}
            </p>
          </div>
          <Select
            aria-label={row.title}
            value={row.current}
            className="!w-auto !py-1 text-[11px]"
            disabled={disabled}
            options={row.options.map((v) => ({
              value: v,
              label: v.toLocaleString(intlLocale()),
            }))}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (next === row.current) return;
              onSave({ [row.field]: next });
            }}
          />
        </div>
      ))}
    </div>
  );
}

function MemberDetail({ user, onClose }: { user: User; onClose: () => void }) {
  const [tab, setTab] = useState<"info" | "grants" | "tenants">("info");
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: databases } = useDatabases();
  const { data: perms } = useUserPermissions(user.id);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient(`/user/${user.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.users });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      toast(t("admin.access.updated"), "success");
    },
    onError: (e: Error) =>
      toast(t("common.updateFailed", { msg: e.message }), "error"),
  });

  const grant = useMutation({
    mutationFn: (vars: { dbId: number; on: boolean }) =>
      vars.on
        ? apiClient(`/user/permission/${user.id}/databases/${vars.dbId}`, {
            method: "POST",
            body: { can_read: true, can_write: true, can_manage: false },
          })
        : apiClient(`/user/permission/${user.id}/databases/${vars.dbId}`, {
            method: "DELETE",
          }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.userPermissions(user.id) }),
    onError: (e: Error) =>
      toast(t("admin.access.grantFailed", { msg: e.message }), "error"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={user.name}
      description={user.email || t("nav.noEmail")}
      width="max-w-lg"
    >
      <Tabs
        ariaLabel={t("admin.access.detailTabs")}
        value={tab}
        onChange={setTab}
        items={[
          { key: "info", label: t("common.basicInfo") },
          { key: "grants", label: t("admin.access.tabGrants"), badge: perms?.length ?? 0 },
          { key: "tenants", label: t("admin.access.tabTenants") },
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
            label={t("common.registeredAt")}
            value={<span className="tnum">{user.created_at?.slice(0, 10) || "—"}</span>}
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
          {/* 配额从个人设置页搬到这里：它是管理员的资源策略，
              放在「我的设置」里就等于让用户自己改自己的上限 */}
          <QuotaEditor
            user={user}
            disabled={patch.isPending}
            onSave={(body) => patch.mutate(body)}
          />
          <div className="flex items-center justify-between gap-3 pt-3">
            <span className="text-[--text-sm] text-ink-muted">{t("common.role")}</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={roleTone(user.role_id)}>
                {t(roleKeyOf(user.role_id))}
              </StatusBadge>
              <Select
                aria-label={t("admin.access.changeRole")}
                value={user.role_id}
                className="!w-auto !py-1 text-[11px]"
                disabled={patch.isPending}
                options={[1, 2, 3].map((roleId) => ({
                  value: roleId,
                  label: t(roleKeyOf(roleId)),
                }))}
                onChange={(e) => {
                  const roleId = Number(e.target.value);
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
        </div>
      )}

      {tab === "grants" && (
        <div>
          <p className="mb-2.5 text-[11px] leading-relaxed text-ink-muted">
            {t("admin.access.grantsHint")}
          </p>
          {!databases?.length ? (
            <EmptyState
              icon={LibraryIcon}
              title={t("admin.vector.noDb")}
              action={
                <Link to="/admin/vector" className="a-btn a-btn-outline">
                  {t("admin.access.goCreateDb")}
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line-subtle">
              {databases.map((db) => {
                const perm = perms?.find((p) => p.database_id === db.id);
                const granted = !!perm;
                return (
                  <li key={db.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[--text-sm] text-ink">{db.name}</p>
                      {db.tenant_name && (
                        <p className="truncate text-[11px] text-ink-subtle">
                          {t("admin.access.tenantOf", { name: db.tenant_name })}
                        </p>
                      )}
                    </div>
                    {granted && (
                      <StatusBadge tone={perm!.can_write ? "success" : "neutral"}>
                        {perm!.can_write
                          ? t("admin.access.grantReadWrite")
                          : t("admin.access.grantReadOnly")}
                      </StatusBadge>
                    )}
                    <button
                      type="button"
                      disabled={grant.isPending}
                      onClick={() => grant.mutate({ dbId: db.id, on: !granted })}
                      className={`a-btn !py-1 text-[11px] ${granted ? "a-btn-danger" : "a-btn-outline"}`}
                    >
                      {granted ? t("admin.access.revoke") : t("admin.access.grant")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "tenants" && <TenantMembershipList user={user} />}
    </Modal>
  );
}

/* ───────────── 成员列表 ───────────── */

function MembersPanel() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<User | null>(null);
  const { data: result, isLoading } = useUsers();
  const users = useMemo(() => result?.users ?? [], [result]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users
      .filter((u) => !roleFilter || String(u.role_id) === roleFilter)
      .filter(
        (u) =>
          !needle ||
          u.name.toLowerCase().includes(needle) ||
          (u.email ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, [users, query, roleFilter]);

  const paged = paginate(rows, page);

  const columns: Column<User>[] = [
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
              {/* 正常态不需要徽章，只有异常值得占用注意力 */
              !u.is_active && (
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
        <StatusBadge tone={roleTone(u.role_id)}>
          {t(roleKeyOf(u.role_id))}
        </StatusBadge>
      ),
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
        title={t("admin.access.memberCount", {
          shown: rows.length,
          total: users.length,
        })}
        actions={
          <>
            <Select
              aria-label={t("admin.access.filterByRole")}
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              className="!w-auto !py-1 text-[11px]"
              placeholder={t("admin.access.allRoles")}
              options={[1, 2, 3].map((roleId) => ({
                value: String(roleId),
                label: t(roleKeyOf(roleId)),
              }))}
            />
            <SearchInput
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder={t("admin.access.searchMembers")}
              className="w-52"
            />
          </>
        }
        footer={
          <Pagination paged={paged} onPageChange={setPage} />
        }
      >
        <DataTable
          columns={columns}
          rows={paged.items}
          rowKey={(u) => u.id}
          loading={isLoading}
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
        <MemberDetail user={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

/* ───────────── 租户 ───────────── */

function TenantMembersModal({
  tenant,
  onClose,
}: {
  tenant: Tenant;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();
  const [pick, setPick] = useState("");
  const { data: members, isLoading } = useTenantMembers(tenant.id);
  const { data: userResult } = useUsers();

  const add = useMutation({
    mutationFn: (userId: number) => tenantAPI.addMember(tenant.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.tenantMembers(tenant.id) });
      setPick("");
      toast(t("admin.access.joinedTenant"), "success");
    },
    onError: (e: Error) =>
      toast(t("admin.access.joinFailed", { msg: e.message }), "error"),
  });

  const remove = useMutation({
    mutationFn: (userId: number) => tenantAPI.removeMember(tenant.id, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.tenantMembers(tenant.id) }),
    onError: (e: Error) =>
      toast(t("admin.access.removeFailed", { msg: e.message }), "error"),
  });

  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const candidates = (userResult?.users ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <Modal
      open
      onClose={onClose}
      title={t("admin.access.tenantMembersTitle", { name: tenant.name })}
      description={
        tenant.database
          ? t("admin.access.tenantDbBound", { db: tenant.database })
          : t("admin.access.tenantNoDb")
      }
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            label={t("admin.access.addMember")}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            placeholder={
              candidates.length
                ? t("admin.access.pickMember")
                : t("admin.access.noMembersToAdd")
            }
            options={candidates.map((u) => ({
              value: u.id,
              label: u.email ? `${u.name} · ${u.email}` : u.name,
            }))}
          />
        </div>
        <button
          type="button"
          className="a-btn a-btn-primary"
          disabled={!pick || add.isPending}
          onClick={() => add.mutate(Number(pick))}
        >
          <PlusIcon className="h-4 w-4" />
          {t("common.add")}
        </button>
      </div>

      <div className="mt-4 border-t border-line-subtle pt-2">
        {isLoading ? (
          <p className="py-6 text-center text-[--text-sm] text-ink-subtle">
            {t("admin.access.loadingMembers")}
          </p>
        ) : !members?.length ? (
          <p className="py-6 text-center text-[--text-sm] text-ink-subtle">
            {t("admin.access.tenantNoMembers")}
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {members.map((m) => {
              const u = userResult?.users.find((x) => x.id === m.user_id);
              return (
                <li key={m.user_id} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[10px] font-semibold text-ink-muted">
                    {(u?.name ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[--text-sm] text-ink">
                      {u?.name ?? t("admin.access.userNumbered", { id: m.user_id })}
                    </p>
                    {m.role && m.role !== "member" && (
                      <p className="text-[11px] text-ink-subtle">{m.role}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="a-btn a-btn-danger !py-1 text-[11px]"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(m.user_id)}
                  >
                    {t("admin.access.remove")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function TenantsPanel({ onCreate }: { onCreate: () => void }) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [managing, setManaging] = useState<Tenant | null>(null);
  const { data: tenants, isLoading } = useTenants();
  const remove = useDeleteTenant();

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (tenants ?? [])
      .filter((tenant) => !needle || tenant.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, [tenants, query]);

  const paged = paginate(rows, page);

  const columns: Column<Tenant>[] = [
    {
      key: "name",
      header: t("common.tenant"),
      cell: (tenant) => (
        <div className="flex items-center gap-2.5">
          <BuildingIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span className="font-medium text-ink">{tenant.name}</span>
        </div>
      ),
    },
    {
      key: "database",
      header: t("admin.access.boundDbHeader"),
      cell: (tenant) =>
        tenant.database ? (
          <Link to="/admin/vector" className="text-accent-ink hover:underline">
            {tenant.database}
          </Link>
        ) : (
          <StatusBadge tone="warning">{t("admin.access.unboundDb")}</StatusBadge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "11rem",
      cell: (tenant) => (
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            className="a-btn a-btn-outline !py-1 text-[11px]"
            onClick={() => setManaging(tenant)}
          >
            {t("common.members")}
          </button>
          <button
            type="button"
            className="a-btn a-btn-danger !py-1 text-[11px]"
            disabled={remove.isPending}
            onClick={() =>
              confirm({
                title: t("admin.access.deleteTenantTitle", { name: tenant.name }),
                message: t("admin.access.deleteTenantMsg"),
                confirmLabel: t("admin.access.deleteTenantConfirm"),
              }).then((ok) => {
                if (ok) {
                  remove.mutate(tenant.id);
                  toast(t("admin.access.tenantDeleted"), "success");
                }
              })
            }
          >
            {t("common.del")}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Panel
        bodyClass="px-4 py-3"
        title={t("admin.access.tenantCount", { n: rows.length })}
        actions={
          <>
            <button
              type="button"
              className="a-btn a-btn-outline !py-1 text-[11px]"
              onClick={onCreate}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {t("admin.access.newTenant")}
            </button>
            <SearchInput
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder={t("admin.access.searchTenants")}
              className="w-52"
            />
          </>
        }
        footer={
          <Pagination paged={paged} onPageChange={setPage} />
        }
      >
        <DataTable
          columns={columns}
          rows={paged.items}
          rowKey={(tenant) => tenant.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={BuildingIcon}
              title={
                query
                  ? t("admin.access.noTenantMatch")
                  : t("admin.access.noTenant")
              }
              description={
                query
                  ? t("common.tryKeyword")
                  : t("admin.access.noTenantDesc")
              }
              action={
                <button type="button" className="a-btn a-btn-primary" onClick={onCreate}>
                  <PlusIcon className="h-4 w-4" />
                  {t("admin.access.newTenant")}
                </button>
              }
            />
          }
        />
      </Panel>

      {managing && (
        <TenantMembersModal tenant={managing} onClose={() => setManaging(null)} />
      )}
    </>
  );
}

/* ───────────── 页面 ───────────── */

export default function AdminAccessPage() {
  const [tab, setTab] = useState<"members" | "tenants">("members");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const { t } = useI18n();
  const { data: user } = useCurrentUser();
  const { data: userResult } = useUsers();
  const { data: tenants } = useTenants();
  const create = useCreateTenant();

  if (!user?.permissions?.includes("admin"))
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

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      <PageHeader
        title={t("page.access")}
        description={t("admin.access.pageDesc")}
      />

      <Tabs
        ariaLabel={t("page.access")}
        value={tab}
        onChange={setTab}
        items={[
          {
            key: "members",
            label: t("common.members"),
            badge: userResult?.total ?? userResult?.users.length ?? 0,
          },
          {
            key: "tenants",
            label: t("common.tenants"),
            badge: tenants?.length ?? 0,
          },
        ]}
      />

      {tab === "members" && <MembersPanel />}
      {tab === "tenants" && <TenantsPanel onCreate={() => setCreating(true)} />}

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
