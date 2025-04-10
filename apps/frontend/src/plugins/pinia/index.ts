import { createPinia } from 'pinia';
import { App } from 'vue';
import persist from 'pinia-plugin-persistedstate'
export default function setupPinia(app: App) {
  const pinia = createPinia()
  pinia.use(persist)
  app.use(pinia)
}