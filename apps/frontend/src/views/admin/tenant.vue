<template>
  <div>
      <el-card>
        <template #header>
          <div class="card-header">
            <h2>学院-Tenants</h2>
          </div>
        </template>
        <div class="header-container">
          <el-button @click="openDialog" type="primary">创建租户</el-button>
          <span style="display: inline-flex">
            <el-input v-model="searchQuery" placeholder="请输入租户名称搜索" clearable style="margin-right: 5px" />
            <el-button @click="performSearch" type="primary">搜索</el-button>
          </span>
        </div>

        <el-table :data="tenants" style="width: 100%">
          <el-table-column prop="id" label="ID" />
          <el-table-column prop="name" label="学院名称 (英)" />
        </el-table>
      </el-card>
      <el-dialog
        title="创建新租户"
        v-model="isDialogVisible"
        width="500"
        @close="resetDialogForm"
        style="z-index: 9999">
        <el-form :model="newTenant">
          <el-form-item label="归属学院 (英)" required>
            <el-input v-model="newTenant.name" />
          </el-form-item>
        </el-form>

        <template #footer>
          <el-button @click="isDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="createNewTenant">创建</el-button>
        </template>
      </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getTenants, createTenant, getTenantByName } from '@/apis/tenant'

export interface Tenant {
  id: string
  tenant_name: string
}

const tenants = ref<Tenant[]>([])
const searchQuery = ref('')
const newTenant = ref({
  name: '',
})
const isDialogVisible = ref(false)

// 页面加载时获取所有租户
onMounted(async () => {
  await fetchTenants()
})

function openDialog() {
  console.log('Dialog Opened')
  isDialogVisible.value = true
}
// // 获取所有租户的函数
async function fetchTenants() {
  const response = await getTenants()
  const data = await response.json()
  tenants.value = data // 确保数据结构匹配
}
// 搜索租户（点击搜索按钮搜索）
async function performSearch() {
  if (searchQuery.value) {
    const response = await getTenantByName(searchQuery.value)
    const data = await response.json()
    // getDatabaseByName返回单个对象，放入数组
    tenants.value = [
      {
        id: '1',
        name: data.name,
      },
    ] as any
  } else {
    fetchTenants() // 如果没有搜索词，重新获取所有集合
  }
}

// 重置弹窗表单的函数
function resetDialogForm() {
  newTenant.value = {
    name: '',
  }
}

// 创建新租户的函数
async function createNewTenant() {
  if (!newTenant.value.name) {
    return alert('请填写完整的信息')
  }

  const newData = newTenant.value

  const response = await createTenant(newData.name)
  if (response.ok) {
    alert('租户创建成功')
    newTenant.value = { name: '' } // 清空表单
    fetchTenants() // 重新获取
    isDialogVisible.value = false // 关闭弹窗
  } else {
    alert('创建失败')
  }
}
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
