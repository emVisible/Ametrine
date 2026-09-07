// src/pages/Dashboard.tsx
import { useNavigate } from "react-router";
import { useCurrentUser } from "../hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { databaseAPI } from "../api/rag";
import { useState, useEffect } from "react";
import OnboardingTour from "../components/OnboardingTour";
import type { UserListResponse } from "../types/user";

const ONBOARDING_KEY = "ametrine_onboarding_done";
export default function Dashboard() {
  const { data: user } = useCurrentUser();
  const navigate = useNavigate();
  const [showOnboarding, setShowOnboarding] = useState(false);

  const { data: usersData } = useQuery<UserListResponse>({
    queryKey: ["users"],
    queryFn: () => apiClient<any>("/user/all"),
    enabled: !!user?.permissions?.includes("admin"),
  });
  const { data: databases } = useQuery({
    queryKey: ["pg-databases"],
    queryFn: databaseAPI.getAll,
  });

  const quickLinks = [
    { label: "LLM Chat", desc: "AI 对话", path: "/chat", icon: "💬" },
    { label: "RAG Chat", desc: "知识库检索", path: "/rag", icon: "🔍" },
    { label: "知识库", desc: "管理文档", path: "/admin/vector", icon: "📚" },
    { label: "个人资料", desc: "查看信息", path: "/profile", icon: "👤" },
    { label: "系统设置", desc: "偏好配置", path: "/settings", icon: "⚙️" },
  ];
  if (user?.permissions?.includes("admin"))
    quickLinks.push({
      label: "用户管理",
      desc: "后台管理",
      path: "/admin",
      icon: "👥",
    });
  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) setShowOnboarding(true);
  }, []);

  const handleCloseOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setShowOnboarding(false);
  };

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-950">
      {showOnboarding && <OnboardingTour onClose={handleCloseOnboarding} />}
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            欢迎回来，{user?.name}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            今天是{" "}
            {new Date().toLocaleDateString("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="知识库"
            value={databases?.length || 0}
            icon="📚"
            color="blue"
          />
          <StatCard label="LLM 对话" value="—" icon="💬" color="indigo" />
          <StatCard
            label="今日用量"
            value={`${user?.daily_token_used?.toLocaleString() || 0} tokens`}
            icon="⚡"
            color="yellow"
          />
          {user?.permissions?.includes("admin") && (
            <StatCard
              label="用户总数"
              value={usersData?.total || 0}
              icon="👥"
              color="green"
            />
          )}
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          快捷入口
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickLinks.map((link) => (
            <button
              key={link.path}
              onClick={() => navigate(link.path)}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 text-left hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all"
            >
              <span className="text-2xl">{link.icon}</span>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mt-2">
                {link.label}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {link.desc}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    indigo:
      "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400",
    green:
      "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400",
    yellow:
      "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400",
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {value}
          </p>
        </div>
        <div
          className={`w-10 h-10 rounded-lg ${colorMap[color] || "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400"} flex items-center justify-center text-lg`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
