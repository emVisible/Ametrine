// src/router.tsx
import { createBrowserRouter, Navigate } from "react-router";
import AppLayout from "./components/AppLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import { pageView } from "./pageView";
import {
  loadAccessPage,
  loadChat,
  loadDashboard,
  loadForbidden,
  loadProfile,
  loadRagChat,
  loadSettings,
  loadVectorPage,
} from "./pageLoaders";

// 加载器定义在 pageLoaders.ts，AppLayout 要用同一批引用做空闲预取；
// 放这里会形成 router → AppLayout → router 的循环依赖。
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "/dashboard", element: pageView(loadDashboard) },
          { path: "/profile", element: pageView(loadProfile) },
          { path: "/settings", element: pageView(loadSettings) },
          { path: "/chat/:convId?", element: pageView(loadChat) },
          { path: "/rag/:convId?", element: pageView(loadRagChat) },
          // 知识库控制台的三级下钻由 URL 承载，刷新与分享都能回到同一位置。
          // 三条路由复用同一个 loader 引用 → 同一份 lazy → 下钻时页面不再被重建。
          { path: "/admin/vector", element: pageView(loadVectorPage) },
          { path: "/admin/vector/:dbId", element: pageView(loadVectorPage) },
          { path: "/admin/vector/:dbId/:colId", element: pageView(loadVectorPage) },
          {
            element: <ProtectedRoute requiredRoles={["admin"]} />,
            children: [
              { path: "/admin/access", element: pageView(loadAccessPage) },
            ],
          },
          { path: "/403", element: pageView(loadForbidden) },
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);
