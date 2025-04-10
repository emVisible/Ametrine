import { RouteRecordRaw } from 'vue-router';
const layouts = import.meta.globEager("../layouts/*.vue")
const views = import.meta.globEager('../views/**/*.vue')

//布局路由
function getRoutes() {
  const layoutRoutes = [] as RouteRecordRaw[]
  Object.entries(layouts).forEach(([file, module]) => {
    const route = getRouteByModel(file, module!)
    route.children = getChildrenRoutes(route)
    layoutRoutes.push(route)
  })
  return layoutRoutes
}
//布局子路由
function getChildrenRoutes(layoutRoute: RouteRecordRaw) {
  const routes = [] as unknown as any
  Object.entries(views).forEach(([file, module]) => {
    if (file.includes(`../views/${layoutRoute.name as string}`)) {
      const route = getRouteByModel(file, module!)
      routes.push(route)
    }
  })
  return routes!
}

function getRouteByModel(file: string, module: { [key: string]: any }) {
  const name = file.replace(/.+layouts\/|.+views\/|\.vue/gi,'')
  const route = {
    name:name.replace('/','.'),
    path: `/${name}`,
    component: module.default
  } as RouteRecordRaw
  return Object.assign(route,module.default?.route)

}
export default getRoutes