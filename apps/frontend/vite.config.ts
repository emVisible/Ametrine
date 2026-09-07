import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import basicSSL from '@vitejs/plugin-basic-ssl'


export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSSL(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      }
    }
  }
})