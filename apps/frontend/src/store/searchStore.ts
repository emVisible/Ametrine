import { defineStore } from 'pinia'
export default defineStore('search', {
  state: () => {
    return {
      params: {
        tenant: '',
        database: '',
        collection: ''
      }
    }
  },
  actions: {
    getTenantParams() {
      return this.params.tenant
    },
    updateTenantParams(search: string) {
      this.params.tenant = search
    },
    getDatabaseParams() {
      return this.params.database
    },
    updateDatabaseParams(search: string) {
      this.params.database = search
    },
    getCollectionParams() {
      return this.params.collection
    },
    updateCollectionParams(search: string) {
      this.params.collection = search
    }
  },
},
)
