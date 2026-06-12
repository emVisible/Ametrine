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
      console.log('登录返回的数据:', data)
      login({ token: data.access_token })

      const user = await authAPI.getCurrentUser()
      login({ user, token: data.access_token })

      queryClient.invalidateQueries()
    },
  })
}

export function useCurrentUser() {
  const token = useAuthStore((state) => state.token)
  const logout = useAuthStore((state) => state.logout)

  return useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await authAPI.getCurrentUser()
      } catch (error: any) {
        if (error.message?.includes('401') || error.message?.includes('过期')) {
          logout()
          window.location.href = '/login'
        }
        throw error
      }
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: false,  // 401 不重试
  })
}