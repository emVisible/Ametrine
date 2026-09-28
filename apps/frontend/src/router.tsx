// src/router.tsx
import { createBrowserRouter, Navigate } from "react-router";
import AppLayout from "./components/AppLayout";
import { LazyPage } from "./components/LazyPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";

// 懒加载工厂用小写命名，避免被 react-refresh 误判为组件
const loadVectorPage = () => import("./pages/AdminVector");

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
          { path: "/dashboard", element: LazyPage(() => import("./pages/Dashboard")) },
          { path: "/profile", element: LazyPage(() => import("./pages/Profile")) },
          { path: "/settings", element: LazyPage(() => import("./pages/Settings")) },
          { path: "/chat/:convId?", element: LazyPage(() => import("./pages/Chat")) },
          { path: "/rag/:convId?", element: LazyPage(() => import("./pages/RAGChat")) },
          // 知识库控制台的三级下钻由 URL 承载，刷新与分享都能回到同一位置
          { path: "/admin/vector", element: LazyPage(loadVectorPage) },
          { path: "/admin/vector/:dbId", element: LazyPage(loadVectorPage) },
          { path: "/admin/vector/:dbId/:colId", element: LazyPage(loadVectorPage) },
          {
            element: <ProtectedRoute requiredRoles={["admin"]} />,
            children: [
              { path: "/admin/access", element: LazyPage(() => import("./pages/AdminAccess")) },
            ],
          },
          { path: "/403", element: LazyPage(() => import("./pages/Forbidden")) },
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
]);
