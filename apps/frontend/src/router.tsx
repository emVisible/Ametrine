// src/router.tsx
import { createBrowserRouter } from 'react-router'
import { ProtectedRoute } from './components/ProtectedRoutes'
import LoginPage from './pages/login'
import RegisterPage from './pages/register'
import Dashboard from './pages/dashboard'
import AdminPage from './pages/admin'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/dashboard', element: <Dashboard /> },
    ],
  },
  {
    element: <ProtectedRoute requiredRoles={['admin']} />,
    children: [
      { path: '/admin', element: <AdminPage /> },
    ],
  },
])