import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import basicSSL from '@vitejs/plugin-basic-ssl'

// localhost 本身就是安全上下文，语音输入所需的 getUserMedia 在纯 HTTP 下也能用；
// 自签证书只会让浏览器与内嵌 WebView 直接拒绝加载。需要局域网访问（非 localhost 的安全上下文）
// 时才用 `VITE_DEV_HTTPS=true pnpm dev --host` 打开 TLS。
const useHttps = process.env.VITE_DEV_HTTPS === 'true'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(useHttps ? [basicSSL()] : []),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
