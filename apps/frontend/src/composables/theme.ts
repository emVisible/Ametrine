import { ref, watchEffect } from 'vue'

type Theme = 'light' | 'dark'
const THEME_KEY = 'ametrine-theme'
const theme = ref<Theme>('light')
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

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null
  theme.value = saved || getSystemTheme()
  applyTheme(theme.value)
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  localStorage.setItem(THEME_KEY, theme.value)
  applyTheme(theme.value)
}

export function useTheme() {
  if (typeof window !== 'undefined') {
    initTheme()
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_KEY)) {
          theme.value = e.matches ? 'dark' : 'light'
          applyTheme(theme.value)
        }
      })
  }
  return {
    theme,
    toggleTheme,
  }
}