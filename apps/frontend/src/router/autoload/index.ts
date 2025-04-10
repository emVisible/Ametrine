import store from '@/utils/store';
import { Router, RouteRecordRaw } from 'vue-router';
import userStore from '../../store/userStore';
import util from "../../utils";
import autoloadModuleRoutes from './module';
import getRoutes from "./view"
import { CacheEnum } from '@/enum/cacheEnum';


let routes: RouteRecordRaw[] = util.env.VITE_ROUTER_AUTOLOAD ? getRoutes() : autoloadModuleRoutes()

function autoload(router: Router) {
  const user = userStore()
  routes = routes.map(route => {
    route.children = route.children?.filter(r => {
      const permission = r.meta?.permission
      return permission ? user.info?.permissions?.includes(permission) : true
    })
    return route
  })
  routes.forEach(r => router.addRoute(r))
}
export default autoload
// const routes = env.VITE_ROUTER_AUTOLOAD ? getRoutes() : [] as RouteRecordRaw[]

// export default routes
