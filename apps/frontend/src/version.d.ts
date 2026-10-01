/// <reference types="vite/client" />

// `VITE_APP_VERSION` 不是给用户填的：它由 vite.config.ts 从 package.json 的 version
// 注入。之所以要有这个声明，是因为 `import.meta.env` 的索引签名是 `any`，
// 拼错键名不会报错、只会在界面上显示 `undefined` —— 而版本角标正是那种没人会去核对的数字。
// 版本号的一致性由 `scripts/doctor.py` 的「版本与 meta」一节检查。
interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
