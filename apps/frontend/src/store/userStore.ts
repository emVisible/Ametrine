import { type UserType, getCurrentUser } from '@/apis/user'
import { CacheEnum } from '@/enum/cacheEnum'
import store from '@/utils/store'
import { defineStore } from 'pinia'
export default defineStore('user', {
  state: () => {
    return {
      info: {} as UserType,
    }
  },
  actions: {
    getUserInfo() {
      return this.info
    },
    setUserInfo(info: UserType) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        this.info = info
      }
    },
    resetUserInfo() {
      this.info = {
        id: 0,
        name: "default",
        email: "default@eamil.com",
        permissions: ["student"]
      }
    }
  },
  persist: true
})
