import { getCurrentUser, login, UserLoginType } from '@/apis/user';
import router from '@/router';
import sessionStore from '@/store/sessionStore';
import { ElMessage, ElMessageBox } from 'element-plus';
import userStore from '../store/userStore';
import { CacheEnum } from './../enum/cacheEnum';
import store from "./store";

export async function loginWrap(values: UserLoginType) {
  // token验证
  const { access_token } = (await login(values)).data
  if ((access_token !== null) || (access_token !== undefined)) {
    store.set(CacheEnum.TOKEN_NAME, access_token)
    // 重定向
    if (!store.get(CacheEnum.REDIRECT_ROUTE_NAME)) {
      store.set(CacheEnum.REDIRECT_ROUTE_NAME, "rag")
    }
    const routeName = store.get(CacheEnum.REDIRECT_ROUTE_NAME) ?? 'home'
    userStore().setUserInfo((await getCurrentUser().then(res => res)).data)
    router.push({ name: routeName })
    location.reload()
    return true
  }
  return false
}
export function logout() {
  ElMessageBox.confirm(
    '退出登录会清空当下的聊天记录, 确定退出登录吗？',
    '确认登出',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  )
    .then(() => {
      ElMessage({
        type: 'success',
        message: '用户已退出登录',
      })
      setTimeout(() => {
        store.remove(CacheEnum.TOKEN_NAME)
        sessionStore().clearAllSession()
        userStore().resetUserInfo()
        router.push('/login')
      }, 3000)
    })
}
export function logout_force() {
  setTimeout(() => {
    store.remove(CacheEnum.TOKEN_NAME)
    sessionStore().clearAllSession()
    userStore().resetUserInfo()
    router.push('/login')
  }, 3000)
}
export function isLogin() {
  return Boolean(store.get(CacheEnum.TOKEN_NAME))
}

export function backToHomepage() {
  setTimeout(() => {
    router.push('/')
  })
}