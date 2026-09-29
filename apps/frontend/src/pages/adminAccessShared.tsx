// src/pages/adminAccessShared.tsx
// 成员与租户两个界面共用的角色/配额零件。
// 单独成文件而不是从 AdminAccess 里导出：组件文件导出非组件成员会触发
// react-refresh/only-export-components，而且页面互相 import 会绕出循环依赖。
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";
import { Select } from "../components/ui";
import type { TenantOverviewUser } from "../types/knowledge";

/**
 * 管理员侧的用量配额编辑，含「无限制」。
 *
 * 无限制走的是 limit = 0（后端把 None 与 0 一并视为无上限），
 * 而不是另开一个布尔列 —— 同一个语义有两个存储位置正是这个项目反复踩过的坑。
 */
export function QuotaEditor({
  user,
  disabled,
  onSave,
}: {
  user: TenantOverviewUser;
  disabled: boolean;
  onSave: (body: Record<string, number>) => void;
}) {
  const { t } = useI18n();
  const UNLIMITED = 0;

  const rows = [
    {
      field: "daily_token_limit",
      title: t("settings.dailyLimit"),
      used: user.daily_token_used ?? 0,
      current: user.daily_token_limit ?? 100_000,
      options: [
        UNLIMITED,
        50_000, 100_000, 200_000, 500_000, 1_000_000,
      ],
    },
    {
      field: "monthly_token_limit",
      title: t("settings.monthlyLimit"),
      used: user.monthly_token_used ?? 0,
      current: user.monthly_token_limit ?? 3_000_000,
      options: [
        UNLIMITED,
        1_000_000, 3_000_000, 5_000_000, 10_000_000, 50_000_000,
      ],
    },
  ];

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {rows.map((row) => {
        const unlimited = row.current <= 0;
        return (
          <div key={row.field} className="min-w-[13rem] flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-muted">{row.title}</span>
              <Select
                aria-label={`${row.title} · ${user.name}`}
                value={row.current}
                className="!w-auto !py-1 text-[11px]"
                panelClassName="w-40"
                disabled={disabled}
                options={row.options.map((v) => ({
                  value: v,
                  label:
                    v === UNLIMITED
                      ? t("settings.quotaUnlimited")
                      : v.toLocaleString(intlLocale()),
                }))}
                onChange={(v) => {
                  const next = Number(v);
                  if (next === row.current) return;
                  onSave({ [row.field]: next });
                }}
              />
            </div>
            {unlimited ? (
              <p className="mt-1 text-[11px] text-ink-subtle">
                {t("settings.quotaUnlimitedNote")}
              </p>
            ) : (
              <>
                <span
                  className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-surface-sunken"
                  aria-hidden
                >
                  <span
                    className={`block h-full rounded-full ${
                      row.used / row.current > 0.9 ? "bg-danger" : "bg-accent"
                    }`}
                    style={{
                      width: `${Math.min(100, (row.used / row.current) * 100)}%`,
                    }}
                  />
                </span>
                <p className="mt-1 text-[11px] text-ink-subtle tnum">
                  {t("settings.quotaUsed", {
                    used: row.used.toLocaleString(intlLocale()),
                    limit: row.current.toLocaleString(intlLocale()),
                  })}
                </p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
