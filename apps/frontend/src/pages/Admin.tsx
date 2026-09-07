// src/pages/Admin.tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "../api/client";
import type { User, UserListResponse } from "../types/user";
import { tenantAPI } from "../api/tenant";

export default function AdminPage() {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const { data: result, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiClient<UserListResponse>("/user/all"),
  });
  const users = result?.users || [];

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-950 min-h-full">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          用户管理
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <StatCard title="总用户数" value={users.length || 0} color="blue" />
          <StatCard
            title="管理员"
            value={users.filter((u) => u.role_id === 3).length || 0}
            color="purple"
          />
          <StatCard
            title="经理"
            value={users.filter((u) => u.role_id === 2).length || 0}
            color="green"
          />
          <StatCard
            title="普通用户"
            value={users.filter((u) => u.role_id === 1).length || 0}
            color="gray"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              用户列表
            </h2>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      用户名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      邮箱
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      角色
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      操作
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      状态
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      已用 Token
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                        {user.id}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">
                        {user.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {user.email}
                      </td>
                      <td className="px-6 py-4">
                        <RoleBadge roleId={user.role_id} />
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                        >
                          查看详情
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${user.is_active ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"}`}
                        >
                          {user.is_active ? "活跃" : "禁用"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {user.total_token_used?.toLocaleString() || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedUser && (
          <UserDetailModal
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
          />
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: "blue" | "green" | "purple" | "gray";
}) {
  const colorMap = {
    blue: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
    green:
      "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    purple:
      "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
    gray: "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {value}
          </p>
        </div>
        <div className={`p-3 rounded-lg ${colorMap[color]}`}>
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ roleId }: { roleId: number }) {
  const roleMap: Record<number, { label: string; color: string }> = {
    1: {
      label: "用户",
      color: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
    },
    2: {
      label: "经理",
      color:
        "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
    },
    3: {
      label: "管理员",
      color:
        "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
    },
  };
  const role = roleMap[roleId] || {
    label: "未知",
    color: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
  };
  return (
    <span
      className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${role.color}`}
    >
      {role.label}
    </span>
  );
}

function UserDetailModal({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const [activeSection, setActiveSection] = useState<
    "info" | "permissions" | "tenant"
  >("info");
  const queryClient = useQueryClient();

  const { data: userPerms } = useQuery({
    queryKey: ["user-permissions", user.id],
    queryFn: () => apiClient<any[]>(`/user/permission/${user.id}/databases`),
  });
  const { data: databases } = useQuery({
    queryKey: ["pg-databases"],
    queryFn: () => apiClient<any[]>("/relation/database/all"),
  });
  const { data: tenants } = useQuery<any[]>({
    queryKey: ["tenants"],
    queryFn: () => tenantAPI.getAll(),
  });

  const updateRole = useMutation({
    mutationFn: (roleId: number) =>
      apiClient(`/user/${user.id}`, {
        method: "PATCH",
        body: { role_id: roleId },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
  const addPerm = useMutation({
    mutationFn: (dbId: number) =>
      apiClient(`/user/permission/${user.id}/databases/${dbId}`, {
        method: "POST",
        body: { can_read: true, can_write: true, can_manage: false },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["user-permissions", user.id],
      }),
  });
  const removePerm = useMutation({
    mutationFn: (dbId: number) =>
      apiClient(`/user/permission/${user.id}/databases/${dbId}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["user-permissions", user.id],
      }),
  });
  const addToTenant = useMutation({
    mutationFn: (tenantId: number) => tenantAPI.addMember(tenantId, user.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["user-tenants", user.id] }),
  });
  const removeFromTenant = useMutation({
    mutationFn: (tenantId: number) => tenantAPI.removeMember(tenantId, user.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["user-tenants", user.id] }),
  });

  const hasDbAccess = (dbId: number) =>
    userPerms?.some((p: any) => p.database_id === dbId);
  const isInTenant = (tenantId: number) =>
    tenants?.some((t: any) => t.id === tenantId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {user.name}
            </h3>
            <div className="flex gap-1">
              {(["info", "permissions", "tenant"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveSection(s)}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${activeSection === s ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium" : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                >
                  {s === "info"
                    ? "基本信息"
                    : s === "permissions"
                      ? "数据库权限"
                      : "租户"}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeSection === "info" && (
            <div className="space-y-3">
              <DetailRow label="ID" value={user.id} />
              <DetailRow label="用户名" value={user.name} />
              <DetailRow label="邮箱" value={user.email || "—"} />
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  角色
                </span>
                <select
                  value={user.role_id}
                  onChange={(e) => updateRole.mutate(Number(e.target.value))}
                  className="text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded px-2 py-1"
                >
                  <option value={1}>用户</option>
                  <option value={2}>经理</option>
                  <option value={3}>管理员</option>
                </select>
              </div>
              <DetailRow
                label="状态"
                value={user.is_active ? "活跃" : "禁用"}
              />
              <DetailRow
                label="注册时间"
                value={user.created_at?.slice(0, 10) || "—"}
              />
              <DetailRow
                label="已用 Token"
                value={user.total_token_used?.toLocaleString() || "0"}
              />
            </div>
          )}

          {activeSection === "permissions" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                为用户分配可访问的知识库。加入租户的用户将自动获得该租户下所有数据库的读权限。
              </p>
              {databases?.map((db: any) => {
                const has = hasDbAccess(db.id);
                return (
                  <div
                    key={db.id}
                    className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700"
                  >
                    <div>
                      <span className="text-sm text-gray-900 dark:text-gray-100">
                        {db.name}
                      </span>
                      {db.tenant_name && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                          ({db.tenant_name})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {has && (
                        <span className="text-[10px] text-green-600 dark:text-green-400">
                          {userPerms?.find((p: any) => p.database_id === db.id)
                            ?.can_write
                            ? "读写"
                            : "只读"}
                        </span>
                      )}
                      <button
                        onClick={() =>
                          has ? removePerm.mutate(db.id) : addPerm.mutate(db.id)
                        }
                        className={`text-xs px-3 py-1 rounded-full ${has ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                      >
                        {has ? "已授权 ✓" : "未授权"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeSection === "tenant" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                将用户加入租户后，自动获得该租户下所有知识库的读权限。
              </p>
              {tenants?.map((t: any) => {
                const inTenant = isInTenant(t.id);
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700"
                  >
                    <div>
                      <span className="text-sm text-gray-900 dark:text-gray-100">
                        {t.name}
                      </span>
                      {t.database && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                          ({t.database})
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        inTenant
                          ? removeFromTenant.mutate(t.id)
                          : addToTenant.mutate(t.id)
                      }
                      className={`text-xs px-3 py-1 rounded-full ${inTenant ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                    >
                      {inTenant ? "已加入 ✓" : "加入"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number | React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {value}
      </span>
    </div>
  );
}
