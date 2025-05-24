import { defineStore } from 'pinia'
type Theme = 'light' | 'dark'
const THEME_KEY = 'ametrine-theme'

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(current: Theme) {
  const root = window.document.documentElement
  if (current === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export const useThemeStore = defineStore('theme-config', {
  state: () => ({
    theme: getSystemTheme() as Theme
  }),
  actions: {
    initTheme() {
      const saved = localStorage.getItem(THEME_KEY) as Theme | null
      if (saved) {
        this.theme = saved
      }
      applyTheme(this.theme)
    },
    toggleTheme() {
      this.theme = this.theme === 'light' ? 'dark' : 'light'
      localStorage.setItem(THEME_KEY, this.theme)
      applyTheme(this.theme)
    },
    getTheme(){
      return this.theme
    }
  },
  persist: true
})