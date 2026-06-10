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
      // 存 token 到 Zustand
      console.log('登录返回的数据:', data)  // 再加一行日志
      login({ token: data.access_token })

      // 拿到 token 后立即获取用户信息
      const user = await authAPI.getCurrentUser()
      login({ user, token: data.access_token })

      // 刷新所有 React Query 缓存
      queryClient.invalidateQueries()
    },
  })
}

export function useCurrentUser() {
  const token = useAuthStore((state) => state.token)

  return useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: authAPI.getCurrentUser,
    enabled: !!token, // 没登录就不发请求
    staleTime: 5 * 60 * 1000,
  })
}