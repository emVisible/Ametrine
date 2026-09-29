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

/**
 * 单一的管理员判定口径。
 *
 * 后端的建/删知识库与集合、租户与成员变更、授权与配额现在全部只允许管理员，
 * 前端如果继续给普通用户渲染这些按钮，点下去只会收到一个 403 toast。
 * 守卫路由用 requiredRoles，界面内的动作可见性用这个 —— 都读同一份 permissions。
 */
export function useIsAdmin(): boolean {
  const { data } = useCurrentUser()
  return !!data?.permissions?.includes('admin')
}