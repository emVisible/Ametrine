// src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router'
import AppLayout from './components/AppLayout'
import { LazyPage } from './components/LazyPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import LoginPage from './pages/Login'
import RegisterPage from './pages/Register'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: LazyPage(() => import('./pages/Dashboard')) },
          { path: '/profile', element: LazyPage(() => import('./pages/Profile')) },
          { path: '/settings', element: LazyPage(() => import('./pages/Settings')) },
          { path: '/chat/:convId?', element: LazyPage(() => import('./pages/Chat')) },
          { path: '/rag/:convId?', element: LazyPage(() => import('./pages/RAGChat')) },
          { path: '/admin/vector', element: LazyPage(() => import('./pages/AdminVector')) },
          { path: '/admin/tenant', element: LazyPage(() => import('./pages/AdminTenant')) },
          {
            element: <ProtectedRoute requiredRoles={['admin']} />,
            children: [
              { path: '/admin', element: LazyPage(() => import('./pages/Admin')) },
            ],
          },
        ],
      },
    ],
  },
])