// src/utils/chunkRecovery.ts
/**
 * 部署后的白屏几乎都同一个原因：浏览器手上的 index.html 还是上一个版本的，
 * 它引用的 /assets/xxx-HASH.js 已经被新的构建替换掉了。取分片失败 → 页面全白，
 * 手动刷新一把拿到新 index.html 就好了 —— 和用户描述一模一样。
 *
 * 这里做两件事：
 * 1) 懒加载分片取不到时自动整页重载一次（拿到新的 index.html），并防止重载循环；
 * 2) 启动成功后清掉看门狗标记，让 index.html 里的启动看门狗闭嘴。
 */

/** index.html 启动看门狗读写的同一个键，改名要两边一起改 */
export const BOOT_RELOAD_KEY = "ametrine:boot-reload";

const CHUNK_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  "Unable to preload CSS",
  "ChunkLoadError",
  "Loading chunk",
];

function looksLikeChunkFailure(reason: unknown): boolean {
  const text =
    reason instanceof Error
      ? `${reason.name} ${reason.message}`
      : typeof reason === "string"
        ? reason
        : "";
  return CHUNK_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

/**
 * 只自救一次：sessionStorage 里有标记就说明这次已经是重载后的加载了，
 * 再失败就不是「版本错配」而是真坏了，继续重载只会变成刷新循环。
 */
function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(BOOT_RELOAD_KEY)) return false;
    sessionStorage.setItem(BOOT_RELOAD_KEY, "1");
  } catch {
    return false; // 隐私模式下 sessionStorage 会抛，宁可不动
  }
  window.location.reload();
  return true;
}

export function installChunkRecovery() {
  // Vite 为分片预加载失败专门派发的事件，payload 就是原始的 fetch/import 错误
  window.addEventListener(
    "vite:preloadError",
    (event) => {
      if (looksLikeChunkFailure(event.payload) && reloadOnce()) {
        event.preventDefault();
      }
    },
    { once: false } as AddEventListenerOptions,
  );

  // 没有 <link rel=modulepreload> 的裸 import()（以及顶层 await 里的失败）不会走上面那个钩子
  window.addEventListener("unhandledrejection", (event) => {
    if (looksLikeChunkFailure(event.reason)) reloadOnce();
  });
}

/** React 挂载成功后调用：解除看门狗，并把单次重试额度还给下一次事故 */
export function markBooted() {
  (window as Window & { __ametrineBooted?: boolean }).__ametrineBooted = true;
  try {
    sessionStorage.removeItem(BOOT_RELOAD_KEY);
  } catch {
    /* 忽略 */
  }
  // 看门狗重进时加的 ?r=<ts> 只是给浏览器换个缓存键，留在地址栏里没有意义
  const url = new URL(window.location.href);
  if (url.searchParams.has("r")) {
    url.searchParams.delete("r");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }
}

