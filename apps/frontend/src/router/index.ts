import { createRouter, createWebHistory } from 'vue-router'
import { App } from 'vue'
import routes from './routes'
import guard from './guard'
import userStore from '../store/userStore'
import autoload from './autoload'
const router = createRouter({
  history: createWebHistory(),
  routes: [...routes],
})

export function setupRouter(app: App) {
  userStore().getUserInfo()
  autoload(router)
  guard(router)
  app.use(router)
}
export default router
