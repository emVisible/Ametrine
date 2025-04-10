/// <reference types="vite/client" />
interface ImportMetaEnv extends ViteEnv{}

interface ImportMeta {
  readonly env: ImportMetaEnv
}


declare module "*.vue" {
  import { defineComponent } from 'vue'
  const Component: ReturnType<typeof defineComponent>
  export default Component
}
declare module '*.ts'

declare module 'vue-area-linkage'