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

const ROLE_LABEL: Record<number, string> = { 1: "用户", 2: "经理", 3: "管理员" };

// 只有管理员值得用强调色，其余角色保持中性：
// 一屏里出现多个彩色徽章时，颜色就不再传递信息了。
function roleTone(roleId: number) {
  return roleId === 3 ? ("accent" as const) : ("neutral" as const);
}

/* ───────────── 成员详情 ───────────── */

function TenantMembershipList({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: tenants } = useTenants();

  const toggle = useMutation({
    mutationFn: (vars: { tenantId: number; join: boolean }) =>
      vars.join
        ? tenantAPI.addMember(vars.tenantId, user.id)
        : tenantAPI.removeMember(vars.tenantId, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access"] });
      toast("租户归属已更新", "success");
    },
    onError: (e: Error) => toast(`变更失败：${e.message}`, "error"),
  });

  if (!tenants?.length)
    return (
      <EmptyState
        icon={BuildingIcon}
        title="还没有租户"
        description="切到「租户」页签先创建一个。"
      />
    );

  return (
    <ul className="divide-y divide-line-subtle">
      {tenants.map((t) => (
        <TenantMemberRow
          key={t.id}
          tenant={t}
          userId={user.id}
          busy={toggle.isPending}
          onToggle={(join) => toggle.mutate({ tenantId: t.id, join })}
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
  const { data: members, isLoading } = useTenantMembers(tenant.id);
  const joined = !!members?.some((m) => m.user_id === userId);

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[--text-sm] text-ink">{tenant.name}</p>
        {tenant.database && (
          <p className="truncate text-[11px] text-ink-subtle">绑定 {tenant.database}</p>
        )}
      </div>
      {isLoading ? (
        <span className="text-[11px] text-ink-subtle">读取中…</span>
      ) : (
        joined && <StatusBadge tone="accent">成员</StatusBadge>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(!joined)}
        className={`a-btn !py-1 text-[11px] ${joined ? "a-btn-danger" : "a-btn-outline"}`}
      >
        {joined ? "移出" : "加入"}
      </button>
    </li>
  );
}

function MemberDetail({ user, onClose }: { user: User; onClose: () => void }) {
  const [tab, setTab] = useState<"info" | "grants" | "tenants">("info");
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
      toast("已更新", "success");
    },
    onError: (e: Error) => toast(`更新失败：${e.message}`, "error"),
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
    onError: (e: Error) => toast(`授权变更失败：${e.message}`, "error"),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={user.name}
      description={user.email || "未填写邮箱"}
      width="max-w-lg"
    >
      <Tabs
        ariaLabel="用户详情"
        value={tab}
        onChange={setTab}
        items={[
          { key: "info", label: "基本信息" },
          { key: "grants", label: "知识库授权", badge: perms?.length ?? 0 },
          { key: "tenants", label: "租户归属" },
        ]}
      />

      {tab === "info" && (
        <div className="divide-y divide-line-subtle">
          <InfoRow label="用户 ID" value={user.id} />
          <InfoRow
            label="账号状态"
            value={
              user.is_active ? (
                <StatusBadge tone="success" dot>
                  正常
                </StatusBadge>
              ) : (
                <StatusBadge tone="danger">已禁用</StatusBadge>
              )
            }
          />
          <InfoRow
            label="注册时间"
            value={<span className="tnum">{user.created_at?.slice(0, 10) || "—"}</span>}
          />
          <InfoRow
            label="最近登录"
            value={
              <span className="tnum">
                {user.last_login_at?.slice(0, 10) || "从未登录"}
              </span>
            }
          />
          <InfoRow
            label="累计 Token"
            value={
              <span className="tnum">
                {(user.total_token_used ?? 0).toLocaleString("zh-CN")}
              </span>
            }
          />
          <div className="flex items-center justify-between gap-3 pt-3">
            <span className="text-[--text-sm] text-ink-muted">角色</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={roleTone(user.role_id)}>
                {ROLE_LABEL[user.role_id] ?? "未知"}
              </StatusBadge>
              <Select
                aria-label="变更角色"
                value={user.role_id}
                className="!w-auto !py-1 text-[11px]"
                disabled={patch.isPending}
                options={[
                  { value: 1, label: "用户" },
                  { value: 2, label: "经理" },
                  { value: 3, label: "管理员" },
                ]}
                onChange={(e) => {
                  const roleId = Number(e.target.value);
                  if (roleId === user.role_id) return;
                  confirm({
                    title: `把 ${user.name} 改为「${ROLE_LABEL[roleId]}」？`,
                    message:
                      roleId === 3
                        ? "管理员可读写全部知识库并绕过按库授权，请确认是有意为之。"
                        : "角色变更后该用户的可访问范围立即改变。",
                    confirmLabel: "确认变更",
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
            按知识库单独授权。租户成员会自动获得该租户知识库的读权限，不必在这里重复授予。
          </p>
          {!databases?.length ? (
            <EmptyState
              icon={LibraryIcon}
              title="还没有知识库"
              action={
                <Link to="/admin/vector" className="a-btn a-btn-outline">
                  去创建知识库
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
                          租户 {db.tenant_name}
                        </p>
                      )}
                    </div>
                    {granted && (
                      <StatusBadge tone={perm!.can_write ? "success" : "neutral"}>
                        {perm!.can_write ? "读写" : "只读"}
                      </StatusBadge>
                    )}
                    <button
                      type="button"
                      disabled={grant.isPending}
                      onClick={() => grant.mutate({ dbId: db.id, on: !granted })}
                      className={`a-btn !py-1 text-[11px] ${granted ? "a-btn-danger" : "a-btn-outline"}`}
                    >
                      {granted ? "撤权" : "授权"}
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
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [users, query, roleFilter]);

  const paged = paginate(rows, page);

  const columns: Column<User>[] = [
    {
      key: "name",
      header: "成员",
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
                <StatusBadge tone="danger">已禁用</StatusBadge>
              )}
            </p>
            <p className="truncate text-[11px] text-ink-subtle">
              {u.email || "未填写邮箱"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "角色",
      width: "7rem",
      cell: (u) => (
        <StatusBadge tone={roleTone(u.role_id)}>
          {ROLE_LABEL[u.role_id] ?? "未知"}
        </StatusBadge>
      ),
    },
    {
      key: "lastLogin",
      header: "最近登录",
      width: "9rem",
      hideBelow: "md",
      cell: (u) => (
        <span className="tnum text-ink-subtle">
          {u.last_login_at?.slice(0, 10) || "从未登录"}
        </span>
      ),
    },
    {
      key: "tokens",
      header: "累计 Token",
      align: "right",
      width: "8rem",
      hideBelow: "sm",
      cell: (u) => (
        <span className="tnum text-ink-muted">
          {(u.total_token_used ?? 0).toLocaleString("zh-CN")}
        </span>
      ),
    },
  ];

  return (
    <>
      <Panel
        bodyClass="px-4 py-3"
        title={`${rows.length} / ${users.length} 个成员`}
        actions={
          <>
            <Select
              aria-label="按角色筛选"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              className="!w-auto !py-1 text-[11px]"
              placeholder="全部角色"
              options={[
                { value: "1", label: "用户" },
                { value: "2", label: "经理" },
                { value: "3", label: "管理员" },
              ]}
            />
            <SearchInput
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder="搜索成员"
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
              title={query || roleFilter ? "没有匹配的成员" : "还没有成员"}
              description={
                query || roleFilter
                  ? "换个关键词或清除筛选。"
                  : "注册入口开放后即可创建账号。"
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
  const [pick, setPick] = useState("");
  const { data: members, isLoading } = useTenantMembers(tenant.id);
  const { data: userResult } = useUsers();

  const add = useMutation({
    mutationFn: (userId: number) => tenantAPI.addMember(tenant.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.tenantMembers(tenant.id) });
      setPick("");
      toast("已加入租户", "success");
    },
    onError: (e: Error) => toast(`加入失败：${e.message}`, "error"),
  });

  const remove = useMutation({
    mutationFn: (userId: number) => tenantAPI.removeMember(tenant.id, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: qk.tenantMembers(tenant.id) }),
    onError: (e: Error) => toast(`移出失败：${e.message}`, "error"),
  });

  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const candidates = (userResult?.users ?? []).filter((u) => !memberIds.has(u.id));

  return (
    <Modal
      open
      onClose={onClose}
      title={`${tenant.name} 的成员`}
      description={
        tenant.database ? `绑定知识库 ${tenant.database}` : "尚未绑定知识库"
      }
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            label="添加成员"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            placeholder={candidates.length ? "选择成员" : "没有可添加的成员"}
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
          添加
        </button>
      </div>

      <div className="mt-4 border-t border-line-subtle pt-2">
        {isLoading ? (
          <p className="py-6 text-center text-[--text-sm] text-ink-subtle">
            读取成员…
          </p>
        ) : !members?.length ? (
          <p className="py-6 text-center text-[--text-sm] text-ink-subtle">
            这个租户还没有成员。
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
                      {u?.name ?? `用户 #${m.user_id}`}
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
                    移出
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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [managing, setManaging] = useState<Tenant | null>(null);
  const { data: tenants, isLoading } = useTenants();
  const remove = useDeleteTenant();

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (tenants ?? [])
      .filter((t) => !needle || t.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [tenants, query]);

  const paged = paginate(rows, page);

  const columns: Column<Tenant>[] = [
    {
      key: "name",
      header: "租户",
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <BuildingIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span className="font-medium text-ink">{t.name}</span>
        </div>
      ),
    },
    {
      key: "database",
      header: "绑定知识库",
      cell: (t) =>
        t.database ? (
          <Link to="/admin/vector" className="text-accent-ink hover:underline">
            {t.database}
          </Link>
        ) : (
          <StatusBadge tone="warning">未绑定知识库</StatusBadge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "11rem",
      cell: (t) => (
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            className="a-btn a-btn-outline !py-1 text-[11px]"
            onClick={() => setManaging(t)}
          >
            成员
          </button>
          <button
            type="button"
            className="a-btn a-btn-danger !py-1 text-[11px]"
            disabled={remove.isPending}
            onClick={() =>
              confirm({
                title: `删除租户「${t.name}」？`,
                message:
                  "不可撤销。若已绑定知识库，解绑后该知识库需重新绑定才能按租户授权访问。",
                confirmLabel: "删除租户",
              }).then((ok) => {
                if (ok) {
                  remove.mutate(t.id);
                  toast("租户已删除", "success");
                }
              })
            }
          >
            删除
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Panel
        bodyClass="px-4 py-3"
        title={`共 ${rows.length} 个租户`}
        actions={
          <>
            <button
              type="button"
              className="a-btn a-btn-outline !py-1 text-[11px]"
              onClick={onCreate}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              新建租户
            </button>
            <SearchInput
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder="搜索租户"
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
          rowKey={(t) => t.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={BuildingIcon}
              title={query ? "没有匹配的租户" : "还没有租户"}
              description={
                query
                  ? "换个关键词试试。"
                  : "租户是检索授权的最小边界，创建后在知识库中绑定即可生效。"
              }
              action={
                <button type="button" className="a-btn a-btn-primary" onClick={onCreate}>
                  <PlusIcon className="h-4 w-4" />
                  新建租户
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
  const { data: user } = useCurrentUser();
  const { data: userResult } = useUsers();
  const { data: tenants } = useTenants();
  const create = useCreateTenant();

  if (!user?.permissions?.includes("admin"))
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
        <PageHeader title="组织与权限" />
        <Panel>
          <EmptyState
            icon={ShieldIcon}
            title="需要管理员权限"
            description="只有管理员可以查看成员与租户配置。"
          />
        </Panel>
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      <PageHeader
        title="组织与权限"
        description="成员、租户与知识库授权共同决定「谁能检索到什么」"
      />

      <Tabs
        ariaLabel="组织与权限"
        value={tab}
        onChange={setTab}
        items={[
          {
            key: "members",
            label: "成员",
            badge: userResult?.total ?? userResult?.users.length ?? 0,
          },
          { key: "tenants", label: "租户", badge: tenants?.length ?? 0 },
        ]}
      />

      {tab === "members" && <MembersPanel />}
      {tab === "tenants" && <TenantsPanel onCreate={() => setCreating(true)} />}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="新建租户"
        description="创建后需在知识库中把它绑定到对应数据库"
        footer={
          <>
            <button
              type="button"
              className="a-btn a-btn-ghost"
              onClick={() => setCreating(false)}
            >
              取消
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
              {create.isPending ? "创建中…" : "创建"}
            </button>
          </>
        }
      >
        <TextInput
          label="租户名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：研发部"
          autoFocus
        />
      </Modal>
    </div>
  );
}
