import { RouteRecordRaw } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'rag',
    component: () => import('@/views/llm/rag.vue'),
    meta: { auth: true, permission: "student" },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/layouts/auth.vue'),
    meta: { guest: true },
    children: [
      {
        name: '',
        path: '',
        component: () => import('@/views/auth/login.vue'),
      }
    ]
  },
  {
    path: '/registry',
    name: 'registry',
    component: () => import('@/layouts/auth.vue'),
    meta: { guest: true },
    children: [
      {
        name: '',
        path: '',
        component: () => import('@/views/auth/registry.vue'),
      }
    ]
  },

] as RouteRecordRaw[]
export default routes
