// src/pageLoaders.ts
import { lazy, type ComponentType } from "react";

/**
 * 路由分片的加载器集中放在这里，而不是写在 router.tsx 里：
 * AppLayout 需要在首帧之后预取它们，若直接从 router 导入会形成
 * router → AppLayout → router 的循环依赖。
 *
 * 引用必须稳定 —— pageView 用引用做 lazy() 的缓存键，
 * 同一个加载器给多个路由（如知识库的三级下钻）复用同一份 lazy，
 * 钻取子路由时页面不会被重建。
 */
export const loadDashboard = () => import("./pages/Dashboard");
export const loadProfile = () => import("./pages/Profile");
export const loadSettings = () => import("./pages/Settings");
export const loadChat = () => import("./pages/Chat");
export const loadRagChat = () => import("./pages/RAGChat");
export const loadVectorPage = () => import("./pages/AdminVector");
export const loadAccessPage = () => import("./pages/AdminAccess");
export const loadQueuePage = () => import("./pages/AdminQueue");
export const loadTenantDetailPage = () => import("./pages/AdminTenantDetail");
export const loadInferencePage = () => import("./pages/AdminInference");
export const loadForbidden = () => import("./pages/Forbidden");

export type PageLoader = () => Promise<{ default: ComponentType }>;

/** 登录后可达的全部页面：空闲时预取一遍，跳转就不再需要等网络 */
export const pageLoaders: PageLoader[] = [
  loadDashboard,
  loadProfile,
  loadSettings,
  loadChat,
  loadRagChat,
  loadVectorPage,
  loadAccessPage,
  loadQueuePage,
  loadTenantDetailPage,
  loadInferencePage,
  loadForbidden,
];

const lazyCache = new WeakMap<PageLoader, ComponentType>();
const inflight = new WeakMap<PageLoader, Promise<unknown>>();

/**
 * `lazy()` 的返回值必须跨渲染保持稳定，否则 React 会卸掉整棵子树重建。
 * 按 loader 引用缓存，一个页面只有一份 lazy。
 */
export function stableLazy(importFn: PageLoader): ComponentType {
  let component = lazyCache.get(importFn);
  if (!component) {
    component = lazy(importFn);
    lazyCache.set(importFn, component);
  }
  return component;
}

/**
 * 提前取分片。动态 import 按 specifier 缓存，跑过一遍之后再导航就是同步命中，
 * 内容区不会出现「空一帧」。失败时删掉记录，允许下次导航重试。
 */
export function preloadRoute(importFn: PageLoader): Promise<unknown> {
  let pending = inflight.get(importFn);
  if (!pending) {
    pending = importFn().catch((error) => {
      inflight.delete(importFn);
      throw error;
    });
    inflight.set(importFn, pending);
  }
  return pending;
}
