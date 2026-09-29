// src/pages/Settings.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import useAuthStore from "../stores/useAuthStore";
import { useTheme } from "../hooks/useTheme";
import { useToast } from "../hooks/useToast";
import { useI18n } from "../i18n/context";
import { LangSwitcher } from "../i18n/I18nProvider";
import { intlLocale } from "../i18n";
import { Tabs } from "../components/ui";
import { CheckIcon, MoonIcon, SunIcon } from "../components/icons";
import type { User } from "../types/user";

type Tab = "general" | "quota";

/** 存文案键而不是文案：切语言时不必重建这张表 */
const TABS: { key: Tab; labelKey: string }[] = [
  { key: "general", labelKey: "settings.tabGeneral" },
  { key: "quota", labelKey: "settings.tabQuota" },
];

function FieldRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-[--text-sm] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] text-ink-subtle">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * 表单初值来自服务端。用「按用户 id 重挂载 + 惰性初始化」取代
 * useEffect 里的 setState —— 后者会触发级联渲染（lint 的 set-state-in-effect）。
 */
function PreferencesPanel({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();
  const { theme, toggle } = useTheme();

  const [preferences, setPreferences] = useState<Record<string, unknown>>(
    () => (user.preferences as Record<string, unknown>) ?? {},
  );

  const save = useMutation({
    mutationFn: () =>
      apiClient(`/user/${user.id}`, {
        method: "PATCH",
        body: { preferences },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", user.id] });
      toast(t("settings.prefsSaved"), "success");
    },
    onError: (e: Error) => toast(t("common.saveFailed", { msg: e.message }), "error"),
  });

  const update = (key: string, value: unknown) =>
    setPreferences((prev) => ({ ...prev, [key]: value }));

  return (
    <section className="a-card px-4">
      <div className="divide-y divide-line-subtle">
        <FieldRow
          title={t("settings.theme")}
          description={t("settings.themeDesc")}
        >
          <button
            type="button"
            onClick={toggle}
            className="a-btn a-btn-outline !py-1"
          >
            {theme === "dark" ? (
              <SunIcon className="h-3.5 w-3.5" />
            ) : (
              <MoonIcon className="h-3.5 w-3.5" />
            )}
            {theme === "dark" ? t("settings.dark") : t("settings.light")}
          </button>
        </FieldRow>

        <FieldRow
          title={t("settings.model")}
          description={t("settings.modelDesc")}
        >
          <select
            value={(preferences.model as string) || "default"}
            onChange={(e) => update("model", e.target.value)}
            aria-label={t("settings.model")}
            className="a-input !w-auto cursor-pointer !py-1"
          >
            <option value="default">{t("settings.systemDefault")}</option>
            <option value="qwen">Qwen</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </FieldRow>

        <FieldRow title={t("settings.uiLang")} description={t("settings.uiLangDesc")}>
          {/* 以前这里写的是 preferences.language —— 全站没人读它，是个死控件；
              现在直接接真正的语言开关（界面语言即时生效，记在本机） */}
          <LangSwitcher />
        </FieldRow>
      </div>

      <div className="flex justify-end border-t border-line-subtle py-3">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="a-btn a-btn-primary"
        >
          {save.isSuccess && <CheckIcon className="h-3.5 w-3.5" />}
          {save.isPending ? t("common.saving") : t("settings.savePrefs")}
        </button>
      </div>
    </section>
  );
}

function QuotaPanel({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();

  const save = useMutation({
    mutationFn: (body: Partial<User>) =>
      apiClient(`/user/${user.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", user.id] });
      toast(t("settings.quotaUpdated"), "success");
    },
    onError: (e: Error) => toast(t("common.updateFailed", { msg: e.message }), "error"),
  });

  const groups = [
    {
      field: "daily_token_limit" as const,
      title: t("settings.dailyLimit"),
      current: user.daily_token_limit,
      used: user.daily_token_used,
      options: [50_000, 100_000, 200_000, 500_000],
    },
    {
      field: "monthly_token_limit" as const,
      title: t("settings.monthlyLimit"),
      current: user.monthly_token_limit,
      used: user.monthly_token_used,
      options: [1_000_000, 3_000_000, 5_000_000, 10_000_000],
    },
  ];

  return (
    <section className="a-card divide-y divide-line-subtle px-4">
      {groups.map((group) => (
        <div key={group.field} className="py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[--text-sm] font-medium text-ink">
              {group.title}
            </p>
            <p className="text-[11px] text-ink-subtle tnum">
              {t("settings.quotaUsed", {
                used: (group.used ?? 0).toLocaleString(intlLocale()),
                limit: (group.current ?? 0).toLocaleString(intlLocale()),
              })}
            </p>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {group.options.map((limit) => {
              const selected = group.current === limit;
              return (
                <button
                  key={limit}
                  type="button"
                  disabled={selected || save.isPending}
                  onClick={() =>
                    save.mutate({ [group.field]: limit } as Partial<User>)
                  }
                  className={`a-btn !py-1 text-[11px] tnum ${
                    selected ? "a-btn-primary" : "a-btn-outline"
                  }`}
                >
                  {selected && <CheckIcon className="h-3 w-3" />}
                  {limit.toLocaleString(intlLocale())}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function SettingsPage() {
  const storedUser = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("general");

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["user", storedUser?.id],
    queryFn: () => apiClient<User>(`/user/${storedUser?.id}`),
    enabled: !!storedUser?.id && !!token,
  });

  return (
    <div className="mx-auto w-full max-w-[48rem] px-4 py-6 md:px-8">
      <header className="mb-5">
        <h1 className="text-[--text-2xl] font-semibold text-ink">
          {t("page.settings")}
        </h1>
        <p className="mt-1 text-[--text-sm] text-ink-muted">
          {t("settings.pageDesc")}
        </p>
      </header>

      <Tabs
        ariaLabel={t("settings.groups")}
        value={activeTab}
        onChange={setActiveTab}
        items={TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
      />

      {isLoading || !user ? (
        <div className="a-card px-4 py-10 text-center text-[--text-sm] text-ink-subtle">
          {t("settings.loadingAccount")}
        </div>
      ) : activeTab === "general" ? (
        <PreferencesPanel key={user.id} user={user} />
      ) : (
        <QuotaPanel key={user.id} user={user} />
      )}
    </div>
  );
}
