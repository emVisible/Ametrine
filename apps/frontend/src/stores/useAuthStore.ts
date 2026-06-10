// src/stores/useAuthStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CurrentUser } from '../types/user'

interface AuthState {
  user: CurrentUser | null
  token: string | null
  isAuthenticated: boolean
  login: (data: { user?: CurrentUser; token?: string }) => void
  logout: () => void
}

const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      login: (data) =>
        set((state) => ({
          user: data.user ?? state.user,
          token: data.token ?? state.token,
          isAuthenticated: !!(data.token ?? state.token),
        })),

      logout: () =>
        set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
    }
  )
)

export default useAuthStore