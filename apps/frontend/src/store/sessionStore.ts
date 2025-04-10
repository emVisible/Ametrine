import { defineStore } from 'pinia'
import store from '@/utils/store'
import { CacheEnum } from '@/enum/cacheEnum'

export type HistoryType = {
  id: string,
  role: string,
  content: string,
  date: string
}

export default defineStore('session', {
  state: () => {
    return {
      sessions: [] as HistoryType[][],
      currentIndex: 0,
      isNeedFlush: true,
      currentConversationIndex: 0
    }
  },
  actions: {
    async getSessionIndex() {
      return this.currentIndex
    },
    async setSessionIndex(value: number) {
      this.currentIndex = value
      return this.currentIndex
    },
    async createSession(historySession: HistoryType[]) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        this.sessions.push(historySession)
      }
    },
    async getSessions() {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        return this.sessions
      }
    },
    async getCurrentSession(index: number) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        return this.sessions[index]
      }
    },
    async updateCurrentSession(data: HistoryType) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        if (this.sessions.length === 0) {
          this.createSession([])
        }
        this.sessions[this.currentIndex].push(data)
      }
    },
    async pushItemToCurrentSession(data: any) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        const targetSession = this.sessions[this.currentIndex]
        const targetObj = targetSession[this.sessions[this.currentIndex].length - 1]
        if (targetObj.content === '...') targetObj.content = ""
        targetObj.id = data.id
        targetObj.date = new Date().toLocaleString()
        targetObj.role = 'machine'
        targetObj.content += data.content
      }
    },
    async setCurrentConversationIndex(value: number) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        this.currentConversationIndex = value
      }
    },
    async setFlush() {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        this.isNeedFlush = !this.isNeedFlush
      }
    },
    async clearAllSession() {
      this.sessions = []
      this.currentConversationIndex = 0
      this.currentIndex = 0
    },
    async isSessionEmpty() {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        return this.sessions.length === 0
      }
    },
    async deleteSessionCurrent(id: number) {
      if (store.get(CacheEnum.TOKEN_NAME)) {
        this.sessions.splice(id, 1)
      }
    },
  },
  persist: true
})
