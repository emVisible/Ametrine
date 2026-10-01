// src/pages/Profile.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../hooks/useAuth";
import { apiClient } from "../api/client";
import useAuthStore from "../stores/useAuthStore";
import { intlLocale } from "../i18n";
import { roleKeyOf } from "../utils/roles";
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
import { useI18n } from "../i18n/context";
import type { User } from "../types/user";

function UsageMeter({
  label,
  value,
  limit,
}: {
  label: string;
  value: number;
  limit?: number;
}) {
  const { t } = useI18n();
  const percent = limit ? Math.min(100, Math.round((value / limit) * 100)) : null;
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-[--text-lg] font-semibold text-ink tnum">
        {value.toLocaleString(intlLocale())}
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
            {t("profile.limitPercent", {
              limit: limit.toLocaleString(intlLocale()),
              percent: percent ?? 0,
            })}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[10px] text-ink-subtle">{t("profile.cumulative")}</p>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { data: currentUser } = useCurrentUser();
  const { t } = useI18n();
  // 角色文案表在 utils/roles 里只有一份：这里曾经复制过一个 Record<number, string>，
  // 两份表会各自漂移，而漂移的表征是界面上出现裸键名。
  const roleLabel = (roleId?: number) => t(roleKeyOf(roleId ?? 1));
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
      toast(t("profile.saved"), "success");
    },
    onError: (e: Error) => toast(t("common.saveFailed", { msg: e.message }), "error"),
  });

  if (isLoading)
    return (
      <div className="mx-auto w-full max-w-[48rem] px-4 py-6 md:px-8">
        <Loading label={t("profile.loading")} />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-[48rem] px-4 py-6 md:px-8">
      <PageHeader
        title={t("page.profile")}
        description={t("profile.pageDesc")}
        actions={
          editing ? (
            <>
              <button
                type="button"
                className="a-btn a-btn-ghost"
                onClick={() => setEditing(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="a-btn a-btn-primary"
                disabled={save.isPending || !form.name.trim()}
                onClick={() => save.mutate()}
              >
                {save.isPending ? t("common.saving") : t("common.save")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="a-btn a-btn-outline"
              onClick={startEditing}
            >
              {t("profile.edit")}
            </button>
          )
        }
      />

      <div className="space-y-5">
        <Panel title={t("common.basicInfo")} bodyClass="divide-y divide-line-subtle px-4">
          {editing ? (
            <div className="space-y-3.5 py-3.5">
              <TextInput
                label={t("auth.username")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <TextInput
                label={t("auth.email")}
                type="email"
                optional={t("auth.optionalField")}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          ) : (
            <>
              <InfoRow label={t("auth.username")} value={user?.name ?? "—"} />
              <InfoRow
                label={t("auth.email")}
                value={user?.email || t("profile.notSet")}
              />
              <InfoRow
                label={t("common.role")}
                value={
                  <StatusBadge
                    tone={user?.role_id === 3 ? "accent" : user?.role_id === 2 ? "success" : "neutral"}
                  >
                    {roleLabel(user?.role_id)}
                  </StatusBadge>
                }
              />
              <InfoRow
                label={t("common.accountStatus")}
                value={
                  user?.is_active ? (
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
                value={<span className="tnum">{user?.created_at?.slice(0, 10) || "—"}</span>}
              />
              <InfoRow
                label={t("common.lastLogin")}
                value={<span className="tnum">{user?.last_login_at?.slice(0, 10) || t("common.neverLoggedIn")}</span>}
              />
            </>
          )}
        </Panel>

        <Panel title={t("profile.permissions")} bodyClass="px-4 py-3.5">
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
              {t("profile.permissionsEmpty")}
            </p>
          )}
        </Panel>

        <Panel
          title={t("profile.usage")}
          description={t("profile.usageDesc")}
          bodyClass="grid grid-cols-2 divide-x divide-line-subtle md:grid-cols-4"
        >
          <UsageMeter
            label={t("profile.today")}
            value={user?.daily_token_used ?? 0}
            limit={user?.daily_token_limit}
          />
          <UsageMeter
            label={t("profile.thisMonth")}
            value={user?.monthly_token_used ?? 0}
            limit={user?.monthly_token_limit}
          />
          <UsageMeter label={t("profile.cumulative")} value={user?.total_token_used ?? 0} />
          <UsageMeter
            label={t("profile.dailyLimit")}
            value={user?.daily_token_limit ?? 0}
          />
        </Panel>

        <Panel
          title={t("profile.prompt")}
          description={t("profile.promptDesc")}
          bodyClass="px-4 py-3.5"
        >
          {editing ? (
            <TextArea
              rows={4}
              value={form.system_prompt}
              onChange={(e) =>
                setForm({ ...form, system_prompt: e.target.value })
              }
              placeholder={t("profile.promptPlaceholder")}
            />
          ) : user?.system_prompt ? (
            <p className="whitespace-pre-wrap rounded-[--radius-md] border border-line-subtle bg-surface-sunken px-3 py-2.5 text-[--text-sm] leading-relaxed text-ink">
              {user.system_prompt}
            </p>
          ) : (
            <p className="text-[--text-sm] text-ink-subtle">
              {t("profile.promptEmpty")}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
