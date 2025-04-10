import { App } from 'vue';
import { setupTailwindcss } from './tailwindcss';
import _ from 'lodash'
import setupElementPlus from './elementui';
import setupPinia from './pinia';
import setupIconPark from './iconPark';

export function setupPlugins(app: App) {
  // autoRegisterComponent(app)
  setupTailwindcss()
  setupElementPlus(app)
  setupPinia(app)
  setupIconPark(app)
}
//全局组件自动注册
// function autoRegisterComponent(app: App) {
//   const components = import.meta.globEager('../components/form/*.vue') as any
//   Object.keys(components).forEach(key => {
//     const name = key.split('/').pop()?.split('.').shift()
//     // console.log(_.camelCase(name))
//     app.component(_.camelCase(name), components[key].default)

//   })
// }
