<template>
  <div>
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>数据库-Database</h2>
        </div>
      </template>
      <div class="header-container">
        <el-button @click="isDialogVisible = true" type="primary">创建数据库</el-button>
      </div>

      <el-table :data="databases" style="width: 100%">
        <el-table-column prop="id" label="ID" />
        <el-table-column prop="name" label="数据库名称" />
        <el-table-column prop="tenant_name" label="归属学院 (英)" />
      </el-table>
    </el-card>

    <el-dialog
      title="创建新数据库"
      v-model="isDialogVisible"
      width="500"
      @close="resetDialogForm"
      style="z-index: 9999">
      <el-form :model="newDatabase">
        <el-form-item label="归属数据库" required>
          <el-input v-model="newDatabase.database_name" />
        </el-form-item>
        <el-form-item label="归属学院 (英)" required>
          <el-input v-model="newDatabase.tenant_name" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="isDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="createNewDatabase">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getDatabases, createDatabase, getDatabaseByName } from '@/apis/database'

export interface DatabaseType {
  id: string
  database_name: string
  tenant_name: string
}

const databases = ref<DatabaseType[]>([])
const searchQuery = ref('')
const newDatabase = ref({
  tenant_name: '',
  database_name: '',
})
const isDialogVisible = ref(false)

onMounted(async () => {
  await fetchDatabases()
})

async function fetchDatabases() {
  const response = await getDatabases()
  const data = await response.json()
  databases.value = data
}


function resetDialogForm() {
  newDatabase.value = {
    tenant_name: '',
    database_name: '',
  }
}

async function createNewDatabase() {
  if (!newDatabase.value.tenant_name || !newDatabase.value.database_name) {
    return alert('请填写完整的信息')
  }

  const newData = newDatabase.value

  const response = await createDatabase({
    name: newData.database_name,
    tenant: newData.tenant_name,
  })
  if (response.ok) {
    alert('集合创建成功')
    newDatabase.value = { tenant_name: '', database_name: '' }
    fetchDatabases()
    isDialogVisible.value = false
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
