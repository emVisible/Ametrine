// src/hooks/useAuth.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authAPI } from '../api/auth'
import useAuthStore from '../stores/useAuthStore'
import type { CurrentUser } from '../types/user'

export function useLogin() {
  const login = useAuthStore((state) => state.login)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: authAPI.login,
    onSuccess: async (data) => {
      login({ token: data.access_token })

      const user = await authAPI.getCurrentUser()
      login({ user, token: data.access_token })

      queryClient.invalidateQueries()
    },
  })
}

export function useCurrentUser() {
  const token = useAuthStore((state) => state.token)

  return useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: () => authAPI.getCurrentUser(),
    // 401 时 apiClient 已经 logout()，这里只需要 enabled 变 false 并让 ProtectedRoute 跳转
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}