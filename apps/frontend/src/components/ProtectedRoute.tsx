// src/components/ProtectedRoute.tsx
import { Navigate, Outlet } from 'react-router'
import useAuthStore from '../stores/useAuthStore'
import { useCurrentUser } from '../hooks/useAuth'

export function ProtectedRoute({ requiredRoles }: { requiredRoles?: string[] }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const user = useAuthStore((state) => state.user)
  const { isError } = useCurrentUser()

  if (!isAuthenticated || isError) {
    return <Navigate to="/login" replace />
  }

  if (requiredRoles && user) {
    const hasRole = requiredRoles.some((role) => user.permissions.includes(role))
    if (!hasRole) {
      return <Navigate to="/403" replace />
    }
  }

  return <Outlet />
}