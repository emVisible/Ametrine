import { RouteRecordRaw } from 'vue-router';
export default {
  name: 'error',
  path: '/error',
  // meta: { auth: true, menu: { show: true, title: "错误", icon:"" } },
  meta: { guest: true },
  children: [
    {
      name: 'error.404',
      path: '404',
      component: () => import('@/views/errors/404.vue'),
      meta: { menu: { title: '404页面' }, permission:"student" },
    },
    {
      name: 'error.403',
      path: '403',
      component: () => import('@/views/errors/403.vue'),
      meta: { menu: { title: '403页面' } , permission:"student"},
    },
    {
      name: 'error.500',
      path: '500',
      component: () => import('@/views/errors/500.vue'),
      meta: { menu: { title: '500页面' } ,permission:"student"},
    },
    {
      path: '/:any(.*)',
      name: 'notFound',
      component: () => import('@/views/errors/404.vue'),
      meta: { guest: true },
    },
  ]
} as RouteRecordRaw