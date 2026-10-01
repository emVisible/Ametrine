// API 前缀只有这一个来源。
//
// 以前这四个文件各写一份字面量（还各用各的引号），默认值是 `http://localhost:3000/api`。
// 那一条会被**编译进 dist**：在开发机上构建、部署到服务器上，产线前端仍然去打
// 「它自己那台机器的 localhost:3000」—— 用户看到的是「页面开了、所有请求全红」。
// 而 `deploy/nginx.conf` 的注释本来就要求同源相对路径 `/api`（由 nginx 反代给 uvicorn），
// 两边说的是两件事。默认值改成相对路径之后：
//   · 开发：vite.config.ts 里已有 `/api` 的 proxy，行为不变；
//   · 生产：`pnpm build` 的产物直接配 nginx 就能用，不需要再设环境变量。
// 只有真的要把 API 放在另一个来源时才设 VITE_API_BASE —— 那时后端的 CORS_ORIGINS
// 必须包含这个前端的来源。
export const API_BASE = import.meta.env.VITE_API_BASE || "/api";
