import { RouteRecordRaw } from 'vue-router';
export default {
  name: 'database',
  path: '/database',
  meta: { auth: true, menu: { title: "知识库管理", icon: "Data", show: true, }, permission: "teacher" },
  component: () => import('@/layouts/admin.vue'),
  children: [
    {
      name: 'admin.tenant',
      path: 'tenant',
      component: () => import('@/views/admin/tenant.vue'),
      meta: { menu: { title: '租户' }, permission: 'admin' }
    },
    {
      name: 'admin.database',
      path: 'database',
      component: () => import('@/views/admin/database.vue'),
      meta: { menu: { title: '数据库' }, permission: 'admin' }
    },
    {
      name: 'admin.collection',
      path: 'collection',
      component: () => import('@/views/admin/collection.vue'),
      meta: { menu: { title: '集合' }, permission: 'manager' }
    },
    {
      name: 'admin.document',
      path: 'document',
      component: () => import('@/views/admin/document.vue'),
      meta: { menu: { title: '文档' }, permission: 'manager' }
    },
  ]
} as RouteRecordRaw
