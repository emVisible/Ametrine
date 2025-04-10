import { ConfigEnv, defineConfig, loadEnv, rollupVersion } from 'vite'
import alias from './vite/alias'
import parseEnv from './vite/util'
import setupPlugins from './vite/plugins/index'
import { visualizer } from 'rollup-plugin-visualizer'
export default ({ command, mode }: ConfigEnv) => {
  const isBuild = command == 'build'
  const root = process.cwd()
  const env = parseEnv(loadEnv(mode, root))
  console.log('env.VITE_API_URL',env.VITE_API_URL)

  return {
    // plugins: [vue()],
    plugins: [...setupPlugins(isBuild, env as any), visualizer()],
    resolve: {
      alias,
    },
    build: {
      rollupOptions: {
        emptyOutDir: true,
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              return id
                .toString()
                .split('node_modules/')[1]
                .split('/')[0]
                .toString()
            }
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_URL,
          changeOrigin: true,
          rerwite: (path:string) => path.replace(/^\/api/, ''),
        }
      },
    },
  }
}
