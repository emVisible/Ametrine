<template>
  <div class="flex flex-col gap-6">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Tenants</span>
        </div>
      </template>
      <el-table :data="tenants" style="width: 100%">
        <el-table-column prop="id" label="Id" />
        <el-table-column prop="name" label="Name" />
      </el-table>
    </el-card>
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Databases</span>
        </div>
      </template>
      <el-table :data="databases" style="width: 100%">
        <el-table-column prop="id" label="Id" />
        <el-table-column prop="name" label="Name" />
        <el-table-column prop="tenant_name" label="TenantName" />
      </el-table>
    </el-card>
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Collections</span>
        </div>
      </template>
      <el-table :data="collections" style="width: 100%">
        <el-table-column prop="id" label="Id" />
        <el-table-column prop="name" label="Name" />
        <el-table-column prop="vest_database" label="DatabaseName" />
        <el-table-column prop="vest_tenant" label="TenantName" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { BaseResponse } from '@/apis/base'
import { getCollections } from '@/apis/collection'
import { getDatabases } from '@/apis/database'
import { getTenants } from '@/apis/tenant'

interface BaseResType {
  id: number
  name: string
}

interface ResCollectionType extends BaseResType {
  vest_database: string
  vest_tenant: string
}

interface ResDatabaseType extends BaseResType {
  tenant_name: string
}

interface ResTenantType extends BaseResType {}

const collections = ref<ResCollectionType[]>([])
const databases = ref<ResDatabaseType[]>([])
const tenants = ref<ResTenantType[]>([])

onMounted(async () => {
  // const resCollections: BaseResponse<ResCollectionType[]> = await (await getCollections()).data
  // const resDatabases: BaseResponse<ResDatabaseType[]> = await (await getDatabases()).data
  // const resTenants: BaseResponse<ResTenantType[]> = await (await getTenants()).data
  // collections.value = resCollections
  // databases.value = resDatabases
  // tenants.value = resTenants
})
</script>

<style scoped></style>
