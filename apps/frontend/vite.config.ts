import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import basicSSL from '@vitejs/plugin-basic-ssl'

// 侧边栏那个版本角标以前是 `const APP_VERSION = "0.1.0"` 写死的：
// 版本号在 src/version.py、pyproject、package.json、tag 四处都会动，唯独它不动，
// 于是发布之后界面还在告诉用户上一个版本。现在从 package.json 读一次，
// 编译期注入 —— 而 `scripts/doctor.py` 已经会检查 package.json 与后端版本号是否一致，
// 所以「界面说的版本」和「部署的版本」之间不再有第二个事实源。
const pkgVersion: string = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version

// localhost 本身就是安全上下文，语音输入所需的 getUserMedia 在纯 HTTP 下也能用；
// 自签证书只会让浏览器与内嵌 WebView 直接拒绝加载。需要局域网访问（非 localhost 的安全上下文）
// 时才用 `VITE_DEV_HTTPS=true pnpm dev --host` 打开 TLS。
const useHttps = process.env.VITE_DEV_HTTPS === 'true'

export default defineConfig({
  define: {
    // 走 `import.meta.env.VITE_*` 而不是自定义全局量：`__APP_VERSION__` 这种裸标识符
    // 在 `pnpm build` 里会被替换，但在 dev server 转换出来的模块里**原样留着**
    // （实测：`/src/components/AppLayout.tsx` 里仍是 `APP_VERSION = __APP_VERSION__`），
    // 于是开发服务器上直接 ReferenceError —— 构建能跑、开发会崩的那种分叉。
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkgVersion),
  },
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
