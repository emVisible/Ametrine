// src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router'
import AppLayout from './components/AppLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import LoginPage from './pages/Login'
import RegisterPage from './pages/Register'
import Dashboard from './pages/Dashboard'
import ProfilePage from './pages/Profile'
import SettingsPage from './pages/Settings'
import ChatPage from './pages/Chat'
import RAGChatPage from './pages/RAGChat'
import AdminPage from './pages/Admin'
import AdminVectorPage from './pages/AdminVector'
import AgentChatPage from './pages/AgentChat'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,  // 全局侧边栏布局
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <Dashboard /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/chat', element: <ChatPage /> },
          { path: '/rag', element: <RAGChatPage /> },
          { path: '/agent', element: <AgentChatPage /> },
          { path: '/admin/vector', element: <AdminVectorPage /> },
          {
            element: <ProtectedRoute requiredRoles={['admin']} />,
            children: [
              { path: '/admin', element: <AdminPage /> },
            ],
          },
        ],
      },
    ],
  },
])