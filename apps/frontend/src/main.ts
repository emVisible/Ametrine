// import { vue } from 'vue';
import { createApp } from 'vue'
import App from './App.vue'
import router, { setupRouter } from '@/router'
import { setupPlugins } from './plugins'
import '../public/styles/global.scss'
import '../public/styles/theme.scss'
import 'animate.css'
async function bootstrap() {
  const app = createApp(App)
  setupPlugins(app)
  setupRouter(app)
  await router.isReady()
  app.mount('#app')
}
bootstrap()
