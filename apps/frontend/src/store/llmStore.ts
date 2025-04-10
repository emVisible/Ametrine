import { CacheEnum } from '@/enum/cacheEnum'
import store from '@/utils/store'
import { defineStore } from 'pinia'
export default defineStore('llm-config', {
  state: () => {
    return {
      currentData: {},
      defaultCollectionName: ''
    }
  },
  actions: {
    async getCurrentData() {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        return this.currentData
      }
    },
    async getDefaultCollectionName() {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        return this.defaultCollectionName
      }
    },
    async updateDefaultCollectionName(newName: string) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        this.defaultCollectionName = newName
      }
    },
  },
  persist: true
})
