// src/pages/Profile.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../hooks/useAuth";
import { apiClient } from "../api/client";
import useAuthStore from "../stores/useAuthStore";
import {
  InfoRow,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
  TextArea,
  TextInput,
} from "../components/ui";
import { useToast } from "../hooks/useToast";
import type { User } from "../types/user";

const ROLE_LABEL: Record<number, string> = { 1: "用户", 2: "经理", 3: "管理员" };

function UsageMeter({
  label,
  value,
  limit,
}: {
  label: string;
  value: number;
  limit?: number;
}) {
  const percent = limit ? Math.min(100, Math.round((value / limit) * 100)) : null;
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-[--text-lg] font-semibold text-ink tnum">
        {value.toLocaleString("zh-CN")}
      </p>
      {limit ? (
        <>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={`h-full rounded-full ${
                percent && percent >= 90 ? "bg-danger" : "bg-accent"
              }`}
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-ink-subtle tnum">
            上限 {limit.toLocaleString("zh-CN")} · {percent ?? 0}%
          </p>
        </>
      ) : (
        <p className="mt-1 text-[10px] text-ink-subtle">累计</p>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { data: currentUser } = useCurrentUser();
  const storedUser = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", system_prompt: "" });

  const { data: user, isLoading } = useQuery({
    queryKey: ["user", storedUser?.id],
    queryFn: () => apiClient<User>(`/user/${storedUser?.id}`),
    enabled: !!storedUser?.id && !!token,
  });

  // 进入编辑态时才播种表单，而不是用 effect 把服务端数据同步进 state
  const startEditing = () => {
    if (user)
      setForm({
        name: user.name ?? "",
        email: user.email ?? "",
        system_prompt: user.system_prompt ?? "",
      });
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: () =>
      apiClient(`/user/${user?.id}`, { method: "PATCH", body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      setEditing(false);
      toast("资料已保存", "success");
    },
    onError: (e: Error) => toast(`保存失败：${e.message}`, "error"),
  });

  if (isLoading)
    return (
      <div className="mx-auto w-full max-w-[48rem] px-4 py-6 md:px-8">
        <Loading label="正在读取个人资料…" />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-[48rem] px-4 py-6 md:px-8">
      <PageHeader
        title="个人资料"
        description="账号信息、权限范围与系统提示词"
        actions={
          editing ? (
            <>
              <button
                type="button"
                className="a-btn a-btn-ghost"
                onClick={() => setEditing(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="a-btn a-btn-primary"
                disabled={save.isPending || !form.name.trim()}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "保存中…" : "保存"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="a-btn a-btn-outline"
              onClick={startEditing}
            >
              编辑资料
            </button>
          )
        }
      />

      <div className="space-y-5">
        <Panel title="基本信息" bodyClass="divide-y divide-line-subtle px-4">
          {editing ? (
            <div className="space-y-3.5 py-3.5">
              <TextInput
                label="用户名"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <TextInput
                label="邮箱"
                type="email"
                optional="选填"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          ) : (
            <>
              <InfoRow label="用户名" value={user?.name ?? "—"} />
              <InfoRow label="邮箱" value={user?.email || "未设置"} />
              <InfoRow
                label="角色"
                value={
                  <StatusBadge
                    tone={user?.role_id === 3 ? "accent" : user?.role_id === 2 ? "success" : "neutral"}
                  >
                    {ROLE_LABEL[user?.role_id ?? 1] ?? "未知"}
                  </StatusBadge>
                }
              />
              <InfoRow
                label="账号状态"
                value={
                  user?.is_active ? (
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
                value={<span className="tnum">{user?.created_at?.slice(0, 10) || "—"}</span>}
              />
              <InfoRow
                label="最近登录"
                value={<span className="tnum">{user?.last_login_at?.slice(0, 10) || "从未登录"}</span>}
              />
            </>
          )}
        </Panel>

        <Panel title="权限范围" bodyClass="px-4 py-3.5">
          {currentUser?.permissions?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {currentUser.permissions.map((perm) => (
                <StatusBadge key={perm} tone="accent">
                  {perm}
                </StatusBadge>
              ))}
            </div>
          ) : (
            <p className="text-[--text-sm] text-ink-subtle">
              暂无显式权限，可访问范围由所属租户决定。
            </p>
          )}
        </Panel>

        <Panel
          title="用量"
          description="限额用于约束本地模型的上下文消耗，可在系统设置中调整"
          bodyClass="grid grid-cols-2 divide-x divide-line-subtle md:grid-cols-4"
        >
          <UsageMeter
            label="今日"
            value={user?.daily_token_used ?? 0}
            limit={user?.daily_token_limit}
          />
          <UsageMeter
            label="本月"
            value={user?.monthly_token_used ?? 0}
            limit={user?.monthly_token_limit}
          />
          <UsageMeter label="累计" value={user?.total_token_used ?? 0} />
          <UsageMeter
            label="日限额"
            value={user?.daily_token_limit ?? 0}
          />
        </Panel>

        <Panel
          title="系统提示词"
          description="附加到每次对话，用于固定回答风格与边界"
          bodyClass="px-4 py-3.5"
        >
          {editing ? (
            <TextArea
              rows={4}
              value={form.system_prompt}
              onChange={(e) =>
                setForm({ ...form, system_prompt: e.target.value })
              }
              placeholder="留空则使用后端默认提示词"
            />
          ) : user?.system_prompt ? (
            <p className="whitespace-pre-wrap rounded-[--radius-md] border border-line-subtle bg-surface-sunken px-3 py-2.5 text-[--text-sm] leading-relaxed text-ink">
              {user.system_prompt}
            </p>
          ) : (
            <p className="text-[--text-sm] text-ink-subtle">
              未设置，使用默认系统提示词。
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
