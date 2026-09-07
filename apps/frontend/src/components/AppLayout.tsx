// src/components/AppLayout.tsx
import { useState, useCallback } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import useAuthStore from "../stores/useAuthStore";
import useSessionStore from "../stores/sessionStore";
import { useCurrentUser } from "../hooks/useAuth";
import { useTheme } from "./ThemeProvider";

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

export default function AppLayout() {
  const { data: user } = useCurrentUser();
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useTheme();

  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const renameSession = useSessionStore((s) => s.renameSession);

  const [activeMode, setActiveMode] = useState<"llm" | "rag">("llm");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleLogout = useCallback(() => {
    logout();
    navigate("/login");
  }, [logout, navigate]);

  const handleNewChat = useCallback(
    (mode: "llm" | "rag" = "llm") => {
      const id = createSession(mode);
      const routeMap = { llm: "chat", rag: "rag" };
      navigate(`/${routeMap[mode]}/${id}`, { replace: true });
    },
    [createSession, navigate],
  );

  const handleDeleteSession = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      deleteSession(id);
    },
    [deleteSession],
  );

  const handleDoubleClick = (id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const submitRename = (id: string) => {
    if (renameValue.trim()) renameSession(id, renameValue.trim());
    setRenamingId(null);
  };

  const modeLabels: Record<string, string> = {
    llm: "LLM 对话",
    rag: "RAG 检索",
  };
  const modeIcons: Record<string, string> = { llm: "💬", rag: "🔍" };

  const modeNavItems = [
    { mode: "llm" as const, label: modeLabels.llm, icon: modeIcons.llm },
    { mode: "rag" as const, label: modeLabels.rag, icon: modeIcons.rag },
  ];

  const otherNavItems: NavItem[] = [
    { path: "/dashboard", label: "仪表盘", icon: "📊" },
    { path: "/admin/vector", label: "知识库", icon: "📚" },
    { path: "/admin/tenant", label: "租户", icon: "🏢" },
  ];

  if (user?.permissions?.includes("admin")) {
    otherNavItems.push({ path: "/admin", label: "用户管理", icon: "👥" });
  }

  const filteredSessions = sessions
    .filter((s) => s.mode === activeMode)
    .filter(
      (s) =>
        !searchQuery ||
        s.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const bg = "bg-white dark:bg-gray-900";
  const bgSecondary = "bg-gray-50 dark:bg-gray-950";
  const border = "border-gray-200 dark:border-gray-700";
  const borderLight = "border-gray-100 dark:border-gray-800";
  const textPrimary = "text-gray-900 dark:text-gray-100";
  const textSecondary = "text-gray-600 dark:text-gray-400";
  const textTertiary = "text-gray-500 dark:text-gray-500";
  const textMuted = "text-gray-400 dark:text-gray-600";
  const hover = "hover:bg-gray-100 dark:hover:bg-gray-800";
  const active =
    "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium";

  const SidebarContent = () => (
    <>
      <div className={`p-3 border-b ${borderLight} space-y-2`}>
        <button
          onClick={() => handleNewChat(activeMode)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 dark:bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          新对话
        </button>

        <div className="flex gap-1">
          {modeNavItems.map((item) => {
            const isActive = activeMode === item.mode;
            return (
              <button
                key={item.mode}
                onClick={() => {
                  setActiveMode(item.mode);
                  const routeMap: Record<string, string> = {
                    llm: "chat",
                    rag: "rag",
                  };
                  const currentModeSessions = sessions.filter(
                    (s) => s.mode === item.mode,
                  );
                  if (currentModeSessions.length > 0) {
                    const latest = currentModeSessions[0];
                    useSessionStore.getState().switchSession(latest.id);
                    navigate(`/${routeMap[item.mode]}/${latest.id}`, {
                      replace: true,
                    });
                  } else {
                    handleNewChat(item.mode);
                  }
                }}
                className={`flex-1 flex flex-col items-center py-1.5 rounded text-[10px] transition-colors ${
                  isActive
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium"
                    : `${textSecondary} ${hover}`
                }`}
              >
                <span className="text-sm mb-0.5">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索对话..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <p className={`text-xs ${textMuted} text-center py-8`}>
            {searchQuery ? "无匹配结果" : "暂无历史记录"}
          </p>
        ) : (
          <div className="py-1">
            {filteredSessions.slice(0, 100).map((s) => (
              <div key={s.id} className="group relative">
                <button
                  onClick={() => {
                    useSessionStore.getState().switchSession(s.id);
                    const routeMap: Record<string, string> = {
                      llm: "chat",
                      rag: "rag",
                    };
                    navigate(`/${routeMap[s.mode]}/${s.id}`, { replace: true });
                  }}
                  className={`w-full text-left px-3 py-2 transition-colors ${currentSessionId === s.id ? `${active} border-r-2 border-indigo-600 dark:border-indigo-500` : hover}`}
                >
                  {renamingId === s.id ? (
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename(s.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => submitRename(s.id)}
                      autoFocus
                      className="w-full text-xs border border-indigo-300 rounded px-1 py-0.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  ) : (
                    <span
                      className={`text-xs truncate block ${currentSessionId === s.id ? "text-indigo-700 dark:text-indigo-400 font-medium" : "text-gray-700 dark:text-gray-300"}`}
                      onDoubleClick={() => handleDoubleClick(s.id, s.title)}
                      title="双击重命名"
                    >
                      {s.title || "新对话"}
                    </span>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] ${textMuted}`}>
                      {s.messages.length} 条
                    </span>
                    <span className={`text-[10px] ${textMuted}`}>
                      {new Date(s.updatedAt).toLocaleDateString("zh-CN", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </button>
                <button
                  onClick={(e) => handleDeleteSession(e, s.id)}
                  className={`absolute right-2 top-2 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 ${textMuted} hover:text-red-600 dark:hover:text-red-400 transition-all`}
                >
                  <svg
                    className="w-3 h-3"
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
            ))}
          </div>
        )}
      </div>
      <div className={`border-t ${borderLight} px-4 py-2`}>
        <button
          onClick={() => navigate("/changelog")}
          className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          v0.1.0
        </button>
      </div>
    </>
  );

  return (
    <div className={`h-screen flex flex-col ${bgSecondary}`}>
      {/* ═══ 顶部 Header ═══ */}
      <header
        className={`h-12 ${bg} border-b ${border} flex items-center px-3 md:px-4 flex-shrink-0 z-10`}
      >
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 mr-2"
        >
          <svg
            className="w-5 h-5 text-gray-600 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        <div className="flex items-center gap-2">
          <img src="/src/assets/icon.png" alt="" className="w-6 h-6" />
          <span
            className={`font-semibold ${textPrimary} text-sm hidden sm:block`}
          >
            Ametrine
          </span>
        </div>

        <div className="flex items-center gap-1 md:gap-2 ml-auto">
          <nav className="hidden md:flex items-center gap-1">
            {otherNavItems.map((item) => {
              const isActive =
                location.pathname === item.path ||
                location.pathname.startsWith(item.path + "/");
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${isActive ? active : `${textSecondary} ${hover}`}`}
                >
                  <span className="text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <button
            onClick={toggleTheme}
            className={`p-1.5 rounded-lg ${textSecondary} ${hover} text-sm`}
            title={theme === "light" ? "切换深色模式" : "切换浅色模式"}
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>

          <div className="relative ml-1">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className={`flex items-center gap-2 px-2 py-1 rounded-lg ${hover} transition-colors`}
            >
              <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-medium">
                {user?.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <span className="text-xs text-gray-700 dark:text-gray-300 hidden sm:block">
                {user?.name}
              </span>
              <svg
                className={`w-3 h-3 ${textMuted}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div
                  className={`absolute right-0 top-full mt-1 w-48 rounded-lg shadow-lg border ${border} ${bg} py-1 z-20`}
                >
                  <div className={`px-4 py-2 border-b ${borderLight}`}>
                    <p className={`text-sm font-medium ${textPrimary}`}>
                      {user?.name}
                    </p>
                    <p className={`text-xs ${textTertiary} truncate`}>
                      {user?.email}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      navigate("/profile");
                      setUserMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm ${textSecondary} ${hover}`}
                  >
                    <span>👤</span>个人资料
                  </button>
                  <button
                    onClick={() => {
                      navigate("/settings");
                      setUserMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm ${textSecondary} ${hover}`}
                  >
                    <span>⚙️</span>系统设置
                  </button>
                  <div className={`border-t ${borderLight}`} />
                  <button
                    onClick={handleLogout}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20`}
                  >
                    <span>🚪</span>退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ═══ 主体 ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* 桌面端左侧栏 */}
        <aside
          className={`w-56 ${bg} border-r ${border} flex-col flex-shrink-0 hidden md:flex`}
        >
          <SidebarContent />
        </aside>

        {/* 移动端抽屉 */}
        {mobileMenuOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 z-20 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside
              className={`md:hidden fixed left-0 top-0 bottom-0 w-56 ${bg} z-30 flex flex-col shadow-xl`}
            >
              <div
                className={`p-3 border-b ${border} flex justify-between items-center`}
              >
                <span className={`font-semibold ${textPrimary} text-sm`}>
                  Ametrine
                </span>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600"
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
              <SidebarContent />
            </aside>
          </>
        )}

        {/* 主内容 */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>

      {/* 移动端底部导航 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-around py-2 z-10">
        {[
          { path: "/chat", icon: "💬", label: "Chat" },
          { path: "/rag", icon: "🔍", label: "RAG" },
          { path: "/dashboard", icon: "📊", label: "仪表盘" },
          { path: "/settings", icon: "⚙️", label: "设置" },
        ].map((item) => (
          <button
            key={item.path}
            onClick={() => {
              if (
                item.path.startsWith("/chat") ||
                item.path.startsWith("/rag")
              ) {
                const mode = item.path === "/chat" ? "llm" : "rag";
                handleNewChat(mode);
              } else {
                navigate(item.path);
              }
            }}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] ${
              location.pathname.startsWith(item.path)
                ? "text-indigo-600 dark:text-indigo-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
