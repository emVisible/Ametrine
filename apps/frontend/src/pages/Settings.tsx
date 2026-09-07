// src/pages/Settings.tsx
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import useAuthStore from "../stores/useAuthStore";
import { useTheme } from "../components/ThemeProvider";
import type { User } from "../types/user";

const allVolumes = [
  "卷一·哲学",
  "卷二·认识论",
  "卷三·人文",
  "卷四·艺术",
  "卷五·科学",
  "卷六·技术",
  "卷七·生命观",
  "卷八·血肉",
];

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const { theme, toggle } = useTheme();

  const [preferences, setPreferences] = useState<Record<string, any>>({});
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "quota" | "cognition">(
    "general",
  );
  const [cognitionMode, setCognitionMode] = useState<"llm" | "rag">("llm");
  const [cognitionConfig, setCognitionConfig] = useState<any>({
    active_volumes: allVolumes,
    max_depth: 3,
  });

  const { data: fullUser } = useQuery<User>({
    queryKey: ["user", user?.id],
    queryFn: () => apiClient<User>(`/user/${user?.id}`),
    enabled: !!user?.id && !!token,
  });

  useEffect(() => {
    if (fullUser?.preferences) setPreferences(fullUser.preferences);
  }, [fullUser]);

  const { data: configs } = useQuery<any[]>({
    queryKey: ["whisper-configs"],
    queryFn: () => apiClient<any[]>("/whisper/configs"),
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (configs) {
      const cfg = configs.find((c: any) => c.mode === cognitionMode);
      if (cfg)
        setCognitionConfig({
          active_volumes: cfg.active_volumes || allVolumes,
          max_depth: cfg.max_depth || 3,
        });
    }
  }, [cognitionMode, configs]);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<User>) =>
      apiClient(`/user/${user?.id}`, { method: "PATCH", body: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user", user?.id] });
      setMessage("设置已保存");
      setTimeout(() => setMessage(""), 3000);
    },
    onError: (error: Error) => setMessage(`保存失败: ${error.message}`),
  });

  const saveCognition = useMutation({
    mutationFn: (data: any) =>
      apiClient(`/whisper/config/${cognitionMode}`, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whisper-configs"] });
      setMessage("认知配置已保存");
      setTimeout(() => setMessage(""), 3000);
    },
    onError: (error: Error) => setMessage(`保存失败: ${error.message}`),
  });

  const updatePreference = (key: string, value: any) =>
    setPreferences({ ...preferences, [key]: value });
  const updateTokenLimit = (
    field: "daily_token_limit" | "monthly_token_limit",
    value: number,
  ) => updateMutation.mutate({ [field]: value });

  const tabs = [
    { key: "general" as const, label: "偏好设置" },
    { key: "quota" as const, label: "用量配额" },
    { key: "cognition" as const, label: "认知配置" },
  ];

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          系统设置
        </h1>

        {message && (
          <div
            className={`mb-4 px-4 py-2 rounded-lg text-sm ${message.includes("失败") ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400" : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"}`}
          >
            {message}
          </div>
        )}

        <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 text-sm rounded-md transition-colors ${activeTab === tab.key ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm font-medium" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "general" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              偏好设置
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    主题
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    界面颜色主题
                  </p>
                </div>
                <button
                  onClick={toggle}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300"
                >
                  {theme === "light" ? "🌙 浅色" : "☀️ 深色"}
                </button>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    默认模型
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    对话时使用的 LLM 模型
                  </p>
                </div>
                <select
                  value={preferences.model || "default"}
                  onChange={(e) => updatePreference("model", e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                >
                  <option value="default">系统默认</option>
                  <option value="qwen">Qwen</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    默认语言
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    AI 回复时使用的语言
                  </p>
                </div>
                <select
                  value={preferences.language || "zh"}
                  onChange={(e) => updatePreference("language", e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                  <option value="auto">自动</option>
                </select>
              </div>
            </div>
            <button
              onClick={() => updateMutation.mutate({ preferences })}
              disabled={updateMutation.isPending}
              className="mt-6 px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50"
            >
              {updateMutation.isPending ? "保存中..." : "保存偏好"}
            </button>
          </div>
        )}

        {activeTab === "quota" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              用量配额
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  每日 Token 限额（当前:{" "}
                  {fullUser?.daily_token_limit?.toLocaleString()}）
                </label>
                <div className="flex gap-2">
                  {[50000, 100000, 200000, 500000].map((limit) => (
                    <button
                      key={limit}
                      onClick={() =>
                        updateTokenLimit("daily_token_limit", limit)
                      }
                      className={`px-3 py-1.5 text-xs rounded-lg border ${fullUser?.daily_token_limit === limit ? "bg-indigo-600 dark:bg-indigo-500 text-white border-indigo-600 dark:border-indigo-500" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
                    >
                      {limit.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  每月 Token 限额（当前:{" "}
                  {fullUser?.monthly_token_limit?.toLocaleString()}）
                </label>
                <div className="flex gap-2">
                  {[1000000, 3000000, 5000000, 10000000].map((limit) => (
                    <button
                      key={limit}
                      onClick={() =>
                        updateTokenLimit("monthly_token_limit", limit)
                      }
                      className={`px-3 py-1.5 text-xs rounded-lg border ${fullUser?.monthly_token_limit === limit ? "bg-indigo-600 dark:bg-indigo-500 text-white border-indigo-600 dark:border-indigo-500" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
                    >
                      {limit.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "cognition" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              认知配置
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              为不同模式配置《从书》轻语的注入深度和广度
            </p>
            <div className="flex gap-2 mb-4">
              {(["llm", "rag"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCognitionMode(mode)}
                  className={`px-3 py-1.5 text-xs rounded-lg ${cognitionMode === mode ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                >
                  {mode === "llm" ? "LLM Chat" : "RAG Chat"}
                </button>
              ))}
            </div>
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                认知深度: {cognitionConfig?.max_depth || 3}
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={cognitionConfig?.max_depth || 3}
                onChange={(e) =>
                  setCognitionConfig({
                    ...cognitionConfig,
                    max_depth: Number(e.target.value),
                  })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                <span>表层</span>
                <span>深层</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {allVolumes.map((vol) => {
                const active = cognitionConfig?.active_volumes?.includes(vol);
                return (
                  <button
                    key={vol}
                    onClick={() => {
                      const vols = cognitionConfig?.active_volumes || [];
                      setCognitionConfig({
                        ...cognitionConfig,
                        active_volumes: active
                          ? vols.filter((v: string) => v !== vol)
                          : [...vols, vol],
                      });
                    }}
                    className={`text-left px-3 py-2 text-xs rounded-lg border ${active ? "border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400" : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
                  >
                    {active ? "✓ " : ""}
                    {vol}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => saveCognition.mutate(cognitionConfig)}
              disabled={saveCognition.isPending}
              className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 disabled:opacity-50"
            >
              {saveCognition.isPending ? "保存中..." : "保存认知配置"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
