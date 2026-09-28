// src/pages/Dashboard.tsx
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { databaseAPI } from "../api/rag";
import { useCurrentUser } from "../hooks/useAuth";
import useSessionStore from "../stores/sessionStore";
import OnboardingTour from "../components/OnboardingTour";
import type { UserListResponse } from "../types/user";
import {
  ChatIcon,
  SearchIcon,
  ClockIcon,
} from "../components/icons";

const ONBOARDING_KEY = "ametrine_onboarding_done";
// 遮罩/Esc 关掉的引导在本次运行内不再打扰，刷新后才重新出现：
// 否则「切走再切回概览」会把刚被用户关掉的东西再糊脸一次
let tourHidden = false;

import type { KbDatabase } from "../types/knowledge";

function Metric({
  label,
  value,
  unit,
  loading,
}: {
  label: string;
  value: number | null;
  unit?: string;
  loading?: boolean;
}) {
  return (
    <div className="a-card px-4 py-3">
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-1 flex items-baseline gap-1 text-[--text-2xl] font-semibold text-ink tnum">
        {loading ? (
          <span className="text-ink-subtle">—</span>
        ) : value == null ? (
          <span className="text-ink-subtle">未启用</span>
        ) : (
          <>
            {value.toLocaleString("zh-CN")}
            {unit && (
              <span className="text-[--text-sm] font-normal text-ink-subtle">
                {unit}
              </span>
            )}
          </>
        )}
      </p>
    </div>
  );
}

export default function Dashboard() {
  const { data: user } = useCurrentUser();
  const navigate = useNavigate();
  // 惰性初始化即可，不需要在 effect 里回读 localStorage 再 setState
  const [showOnboarding, setShowOnboarding] = useState(
    () => !tourHidden && !localStorage.getItem(ONBOARDING_KEY),
  );

  const isAdmin = !!user?.permissions?.includes("admin");
  const sessions = useSessionStore((s) => s.sessions);

  const { data: usersData, isLoading: usersLoading } =
    useQuery<UserListResponse>({
      queryKey: ["users"],
      queryFn: () => apiClient<UserListResponse>("/user/all"),
      enabled: isAdmin,
    });

  const { data: databases, isLoading: dbLoading } = useQuery({
    queryKey: ["pg-databases"],
    queryFn: databaseAPI.getAll,
  });

  const hideOnboarding = () => {
    tourHidden = true;
    setShowOnboarding(false);
  };
  // 只有明确的「跳过」或走完最后一步才写永久标记：
  // 遮罩点击和 Esc 只是这次不看，误触不该让新用户永远失去引导
  const finishOnboarding = () => {
    tourHidden = true; // 写不进 localStorage 时（隐私模式）至少本次运行不再弹
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch {
      /* 隐私模式写不进去，本次会话内仍然生效 */
    }
    setShowOnboarding(false);
  };

  // 只保留侧栏没有的入口。原先这里又列了一遍知识库/设置/组织与权限，
  // 与左侧导航重复，等于同一屏两个地方指向同一个页面。
  const entries = [
    {
      to: "/chat",
      label: "模型对话",
      desc: "不检索知识库的自由对话",
      Icon: ChatIcon,
    },
    {
      to: "/rag",
      label: "知识检索",
      desc: "基于文档分块作答并给出引用",
      Icon: SearchIcon,
    },
  ];

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort(
          (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
        )
        .slice(0, 5),
    [sessions],
  );

  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      {showOnboarding && (
        <OnboardingTour onHide={hideOnboarding} onFinish={finishOnboarding} />
      )}

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[--text-2xl] font-semibold text-ink">
            {user?.name ? `欢迎回来，${user.name}` : "概览"}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-[--text-sm] text-ink-muted">
            <ClockIcon className="h-3.5 w-3.5" />
            {today}
          </p>
        </div>
        <Link
          to="/rag"
          className="a-btn a-btn-outline"
        >
          <SearchIcon className="h-4 w-4" />
          开始一次检索
        </Link>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="知识库"
          value={databases?.length ?? 0}
          loading={dbLoading}
        />
        <Metric label="本地会话" value={sessions.length} />
        <Metric
          label="今日 Token"
          value={user?.daily_token_used ?? 0}
          unit="tokens"
        />
        {isAdmin && (
          <Metric
            label="系统用户"
            value={usersData?.total ?? 0}
            loading={usersLoading}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="space-y-5">
          <div>
            <h2 className="a-section-title mb-2.5">开始</h2>
            <div className="anim-stagger grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {entries.map(({ to, label, desc, Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="a-card group flex flex-col gap-2 px-3.5 py-3 transition-ui hover:border-accent-border hover:bg-surface-sunken"
                >
                  <Icon className="h-4 w-4 text-accent-ink" />
                  <span>
                    <span className="block text-[--text-sm] font-medium text-ink">
                      {label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-subtle">
                      {desc}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className="a-section-title mb-2.5">最近会话</h2>
            <div className="a-card overflow-hidden">
              {recentSessions.length === 0 ? (
                <p className="px-3.5 py-8 text-center text-[--text-sm] text-ink-subtle">
                  还没有会话，从上方任一种对话开始。
                </p>
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {recentSessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/${s.mode === "rag" ? "rag" : "chat"}/${s.id}`}
                        className="flex items-center gap-2.5 px-3.5 py-2 transition-ui hover:bg-surface-sunken"
                      >
                        {s.mode === "rag" ? (
                          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                        ) : (
                          <ChatIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[--text-sm] text-ink">
                          {s.title || "新对话"}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-subtle tnum">
                          {s.messages.length} 条
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section>
          <h2 className="a-section-title mb-2.5">知识库状态</h2>
          <div className="a-card overflow-hidden">
            {dbLoading ? (
              <p className="px-3.5 py-8 text-center text-[--text-sm] text-ink-subtle">
                正在加载知识库…
              </p>
            ) : !databases?.length ? (
              <p className="px-3.5 py-8 text-center text-[--text-sm] text-ink-subtle">
                还没有知识库，先在知识库管理中创建并上传文档。
              </p>
            ) : (
              <table className="a-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>描述</th>
                  </tr>
                </thead>
                <tbody>
                  {databases.map((db: KbDatabase) => (
                    <tr key={db.id}>
                      <td className="font-medium whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          {db.name}
                          {/* 可用不需要徽章，只有停用才值得占用注意力 */}
                          {db.is_active === false && (
                            <span className="a-badge border-danger-border bg-danger-soft text-danger">
                              停用
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="max-w-[16rem] truncate text-ink-muted">
                        {db.description || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex items-center justify-between border-t border-line-subtle px-3.5 py-2">
              <button
                type="button"
                onClick={() => navigate("/admin/vector")}
                className="text-[11px] text-accent-ink hover:underline"
              >
                管理文档与索引
              </button>
              <span className="text-[11px] text-ink-subtle tnum">
                共 {databases?.length ?? 0} 个
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
