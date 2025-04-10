import { RouteLocationNormalized, Router } from "vue-router"
import { CacheEnum } from "../enum/cacheEnum"
import util from "../utils"
import userStore from "@/store/userStore"
import utils from "../utils"
import menuStore from "@/store/menuStore"

class Guard {
  constructor(private router: Router) { }
  public run() {
    this.router.beforeEach(this.beforeEach.bind(this))
  }
  private token(): string | null {
    return util.store.get(CacheEnum.TOKEN_NAME)
  }
  private getUserInfo() {
    if (this.token()) return userStore().getUserInfo()
  }
  private isLogin(route: RouteLocationNormalized): boolean {
    const state = Boolean(!route.meta.auth || (route.meta.auth && this.token()))
    if (state === false) {
      utils.store.set(CacheEnum.REDIRECT_ROUTE_NAME, route.name)
    }
    return state

  }
  private isGuest(route: RouteLocationNormalized): boolean {
    return Boolean(!route.meta.guest || (route.meta.guest && !this.token()))
  }

  private async beforeEach(to: RouteLocationNormalized, from: RouteLocationNormalized) {
    // 需要登录但未登录, 重定向到登录
    if (this.isLogin(to) == false) return { name: 'login' }
    //  如果需要验证, 但是没有token, 重定向到登录
    if (to.meta.auth && !this.token()) return { name: 'login' }
    // 如果不允许游客访问, 返回到原来的页面
    if (this.isGuest(to) == false) return from
    // 如果允许游客访问且已登录, 转到对应页面
    if (to.meta.guest && this.token()) return to
    menuStore().addHistoryMenu(to)
  }
}
export default (router: Router) => {
  new Guard(router).run()
}