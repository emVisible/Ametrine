<template>
  <Datalist type="database" @search="search" @openDialog="openDialog" createTitle="Create">
    <template #default>
      <el-table :data="databases" style="width: 100%">
        <el-table-column prop="name" label="数据库名称" />
        <el-table-column prop="tenant" label="隶属租户" />
        <el-table-column prop="database.replica.name" label="副本数(Replica)" />
      </el-table>
      <el-dialog
        title="创建新数据库"
        v-model="isDialogVisible"
        width="500"
        @close="resetDialogForm"
        style="z-index: 9999">
        <el-form :model="newDatabase">
          <el-form-item label="名称" required>
            <el-input v-model="newDatabase.database_name" />
          </el-form-item>
          <el-form-item label="隶属租户" required>
            <el-input v-model="newDatabase.tenant" />
          </el-form-item>
          <el-form-item label="副本数(Replica)" required>
            <el-input v-model="newDatabase.replica" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="isDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="createNewDatabase">创建</el-button>
        </template>
      </el-dialog>
    </template>
  </Datalist>
</template>

<script setup lang="ts">
import { createDatabase, getDatabaseDetail, getDatabasesDetail } from '@/apis/database'
import Datalist from '@/components/admin/datalist.vue'
import searchStore from '@/store/searchStore'
import { onMounted, ref } from 'vue'

export interface DatabaseType {
  name: string
  tenant: string
  'database.replica.name': number
}
const isDialogVisible = ref(false)
const store = searchStore()
const databases = ref<DatabaseType[]>([])
const newDatabase = ref({
  tenant: '',
  database_name: '',
  replica: 1,
})
const openDialog = () => (isDialogVisible.value = true)
const resetDialogForm = () => {
  newDatabase.value = {
    tenant: '',
    database_name: '',
    replica: 1,
  }
}
const search = async () => {
  const response = await getDatabaseDetail(store.params.database)
  databases.value = [{ ...response.data }]
}
const fetchDatabases = async () => {
  const response = await getDatabasesDetail()
  databases.value = response.data
}

const createNewDatabase = async () => {
  const newData = newDatabase.value
  const response = await createDatabase({
    db_name: newData.database_name,
    tenant_name: newData.tenant,
    replica_number: newData.replica ?? 1,
  })
  if (response.ok) {
    newDatabase.value = { tenant: '', database_name: '', replica: 1 }
    fetchDatabases()
    isDialogVisible.value = false
  }
}
onMounted(async () => await fetchDatabases())
</script>

<style scoped>
.header-container {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-wrap: nowrap;
  margin-top: 5px;
}
</style>
