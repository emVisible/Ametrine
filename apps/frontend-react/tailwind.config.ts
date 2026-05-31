import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#17202a',
        mist: '#edf2f7',
        ametrine: '#8f7cf6',
        honey: '#f1b45b',
        river: '#3a8fb7',
        leaf: '#4f8a67',
      },
    },
  },
  plugins: [],
} satisfies Config
