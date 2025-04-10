import 'vue-router'
declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
    guest?: boolean
    enterClass?: string
    leaveClass?: string
    permission?: string
    menu?: {
      title?: string
      icon?: any
      show?: boolean
    }
  }
}