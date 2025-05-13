<template>
  <Datalist type="tenant" @search="searchTenant" @openDialog="openDialog" createTitle="Create">
    <template #default>
      <el-table :data="tenants" style="width: 100%">
        <el-table-column prop="id" label="ID" />
        <el-table-column prop="name" label="租户名" />
        <el-table-column prop="database" label="绑定数据库" />
      </el-table>
      <el-dialog title="创建新租户" v-model="isDialogVisible" width="500" @close="resetDialog" style="z-index: 9999">
        <el-form :model="newTenant">
          <el-form-item label="租户名称" required>
            <el-input v-model="newTenant.name" />
          </el-form-item>
          <el-form-item label="数据库名称" required>
            <el-input v-model="newTenant.database" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="isDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="createNewTenant">创建</el-button>
        </template>
      </el-dialog>
    </template>
  </Datalist>
</template>

<script setup lang="ts">
import { createTenant, getTenantByName, getTenants } from '@/apis/tenant'
import Datalist from '@/components/admin/datalist.vue'
import searchStore from '@/store/searchStore'
import { onMounted, ref } from 'vue'

export interface Tenant {
  id: string
  tenant_name: string
  database_name: string
}
const isDialogVisible = ref(false)
const tenants = ref<Tenant[]>([])
const newTenant = ref({
  name: '',
  database: '',
})

const openDialog = () => {
  isDialogVisible.value = true
}
const resetDialog = () => {
  newTenant.value = {
    name: '',
    database: '',
  }
}
const fetchTenants = async () => {
  const response = await getTenants()
  tenants.value = response.data
}

const searchTenant = async () => {
  const searchQuery = searchStore().params.tenant
  if (!searchQuery) {
    fetchTenants()
    return
  }
  const response = await getTenantByName(searchQuery).then((res) => res.json())
  const { id, name, database } = response.data
  tenants.value = [
    {
      id,
      name,
      database,
    },
  ] as any
}

const createNewTenant = async () => {
  const newData = newTenant.value
  const response = await createTenant(newData.name, newData.database)
  if (response.ok) {
    newTenant.value = { name: '', database: '' }
    fetchTenants()
    isDialogVisible.value = false
  }
}

onMounted(async () => await fetchTenants())
</script>
