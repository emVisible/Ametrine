import { CacheEnum } from './../enum/cacheEnum'
import { RouteLocationNormalized } from 'vue-router'
import { IMenu } from '../../types/menu'
import { defineStore } from 'pinia'
import router from '@/router'
import utils from '../utils'
export default defineStore('menu', {
  state: () => {
    return {
      menus: [] as IMenu[],
      historyMenu: [] as IMenu[],
    }
  },
  actions: {
    init() {
      this.getMenuByRoute()
      this.historyMenu = utils.store.get(CacheEnum.HISTORY_MENU) ?? []
    },
    addHistoryMenu(route: RouteLocationNormalized) {
      if (!route.meta?.menu) return
      const menu: IMenu = { ...route.meta?.menu, route: route.name as string }
      const isHas = this.historyMenu.some((menu) => menu.route == route.name)
      if (!isHas) this.historyMenu.unshift(menu)
      if (this.historyMenu.length > 10) {
        this.historyMenu.pop()
      }
      utils.store.set(CacheEnum.HISTORY_MENU, this.historyMenu)
    },
    removeHistoryMenu(menu: IMenu) {
      const index = this.historyMenu.indexOf(menu)
      this.historyMenu.splice(index, 1)
    },
    //根据路由获取菜单
    getMenuByRoute() {
      this.menus = router
        .getRoutes()
        .filter((route) => route.children.length && route.meta.menu)
        .map((route) => {
          let menu: IMenu = { ...route.meta?.menu }
          menu.children = route.children
            .filter((route) => route.meta?.menu)
            .map((route) => {
              return { ...route.meta?.menu, route: route.name }
            }) as IMenu[]
          return menu
        })
        .filter((menu) => menu.children?.length) as IMenu[]
    },
  },
})
