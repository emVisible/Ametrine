// src/pages/Settings.tsx
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import useAuthStore from "../stores/useAuthStore";
import { speechRecognitionAvailable, useDevicePrefs } from "../stores/devicePrefs";
import { useTheme } from "../hooks/useTheme";
import { useToast } from "../hooks/useToast";
import { useI18n } from "../i18n/context";
import { LangSwitcher } from "../i18n/I18nProvider";
import { intlLocale } from "../i18n";
import { Select, Tabs } from "../components/ui";
import { CheckIcon, InfoIcon, MoonIcon, SunIcon, WarningIcon } from "../components/icons";
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

  const voiceOn = useDevicePrefs((s) => s.voiceInput);
  const setVoiceInput = useDevicePrefs((s) => s.setVoiceInput);
  const speechOk = speechRecognitionAvailable();

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
          <Select
            aria-label={t("settings.model")}
            value={(preferences.model as string) || "default"}
            onChange={(v) => update("model", String(v))}
            className="!w-auto"
            panelClassName="w-44"
            options={[
              { value: "default", label: t("settings.systemDefault") },
              { value: "qwen", label: "Qwen" },
              { value: "deepseek", label: "DeepSeek" },
            ]}
          />
        </FieldRow>

        <FieldRow title={t("settings.uiLang")} description={t("settings.uiLangDesc")}>
          {/* 以前这里写的是 preferences.language —— 全站没人读它，是个死控件；
              现在直接接真正的语言开关（界面语言即时生效，记在本机） */}
          <LangSwitcher />
        </FieldRow>

        <FieldRow
          title={t("settings.voiceInput")}
          description={t("settings.voiceDesc")}
        >
          <div className="flex flex-col items-end gap-1.5">
            <button
              type="button"
              role="switch"
              aria-checked={voiceOn}
              disabled={!speechOk}
              onClick={() => setVoiceInput(!voiceOn)}
              className={`a-btn !py-1 ${voiceOn ? "a-btn-primary" : "a-btn-outline"}`}
            >
              {voiceOn ? t("settings.voiceOn") : t("settings.voiceOff")}
            </button>
            {/* 联网前提是硬信息，不能只写在 tooltip 里：这决定内网部署能不能开 */}
            <p className="max-w-[24rem] text-right text-[11px] leading-relaxed text-ink-subtle">
              {speechOk ? t("settings.voiceNet") : t("settings.voiceUnsupported")}
            </p>
          </div>
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

/**
 * 用量配额：只读。
 *
 * 配额是管理员的资源策略，不是个人偏好 —— 以前这一页让用户自己点一下就把自己
 * 的日限从 10 万改成 1000 万（后端 PATCH 只挡了 role_id）。现在改的口在
 * 「组织与权限」里（管理员侧），这一页只回答「我用了多少、上限是多少」。
 */
function QuotaPanel({ user }: { user: User }) {
  const { t } = useI18n();
  // /user/{id} 返回的是 User（没有 permissions 字段），管理员身份看 role_id：3 = 管理员
  const isAdmin = user.role_id === 3;

  const rows = [
    {
      key: "daily",
      title: t("settings.dailyLimit"),
      used: user.daily_token_used ?? 0,
      limit: user.daily_token_limit ?? 0,
    },
    {
      key: "monthly",
      title: t("settings.monthlyLimit"),
      used: user.monthly_token_used ?? 0,
      limit: user.monthly_token_limit ?? 0,
    },
  ];

  return (
    <section className="a-card divide-y divide-line-subtle px-4">
      {rows.map((row) => {
        const pct =
          row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0;
        return (
          <div key={row.key} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[--text-sm] font-medium text-ink">{row.title}</p>
              <p className="text-[11px] text-ink-subtle tnum">
                {t("settings.quotaUsed", {
                  used: row.used.toLocaleString(intlLocale()),
                  limit: row.limit.toLocaleString(intlLocale()),
                })}
              </p>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-label={row.title}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`h-full rounded-full ${pct >= 90 ? "bg-warning" : "bg-accent"}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}

      <p className="flex items-start gap-2 py-3 text-[11px] leading-relaxed text-ink-muted">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden />
        <span>
          {isAdmin ? t("settings.quotaManagedAdmin") : t("settings.quotaManaged")}{" "}
          {isAdmin && (
            <Link to="/admin/access" className="text-accent-ink hover:underline">
              {t("page.access")}
            </Link>
          )}
        </span>
      </p>

      {/* 限额目前不拦截任何请求：与其让人以为改了数字就生效，不如把状态写在脸上 */}
      <p className="flex items-start gap-2 py-3 text-[11px] leading-relaxed text-warning">
        <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t("settings.quotaNotEnforced")}</span>
      </p>
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
