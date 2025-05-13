<template>
  <Datalist type="database" @search="fetchDatabases" @openDialog="openDialog" createTitle="Create">
    <template #default>
      <div class="flex-1">
        <el-segmented v-model="currentDatabaseName" :options="databases" />
        <el-table :data="collections" style="width: 100%">
          <el-table-column prop="collection_name" label="集合名称" />
          <el-table-column prop="description" label="描述" />
          <el-table-column prop="num_shards" label="分区" />
          <el-table-column prop="consistency_level" label="等级" />
        </el-table>
      </div>
      <el-dialog title="创建新集合" v-model="isDialogVisible" width="500" @close="resetDialog" style="z-index: 9999">
        <el-form :model="newCollection">
          <el-form-item label="集合名称" required>
            <el-input v-model="newCollection.collection_name" />
          </el-form-item>
          <el-form-item label="归属数据库" required>
            <el-input v-model="newCollection.database_name" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="isDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="createNewCollection">创建</el-button>
        </template>
      </el-dialog>
    </template>
  </Datalist>
</template>

<script setup lang="ts">
import { type OptionsType } from '#/ui'
import { createCollection, getCollectionDetails } from '@/apis/collection'
import { getDatabases } from '@/apis/database'
import Datalist from '@/components/admin/datalist.vue'
import { onMounted, ref } from 'vue'

const isDialogVisible = ref(false)
const options = ref<OptionsType[]>([])
const collections = ref<string[]>([])
const databases = ref<string[]>([])
const currentDatabaseName = ref('')
const newCollection = ref({
  collection_name: '',
  database_name: '',
})
const openDialog = () => (isDialogVisible.value = true)
const resetDialog = () => {
  newCollection.value = {
    collection_name: '',
    database_name: '',
  }
}
const fetchDatabases = async () => {
  const response = await getDatabases()
  databases.value = response.data
}
const fetchCollections = async () => {
  const response = await getCollectionDetails({
    database_name: currentDatabaseName.value,
  })
  collections.value = response.data
  const names: OptionsType[] = []
  response.data.forEach((name: string) => {
    const optionItem: OptionsType = {
      label: name,
      value: name,
    }
    names.push(optionItem)
  })
  options.value = names
}

const createNewCollection = async () => {
  const newData = newCollection.value
  const response = await createCollection(newData)
  if (response.ok) {
    newCollection.value = { collection_name: '', database_name: '' }
    fetchCollections()
    isDialogVisible.value = false
  }
}
onMounted(async () => await fetchDatabases())
watch(currentDatabaseName, () => fetchCollections())
</script>

<style scoped lang="scss">
.header-container {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-wrap: nowrap;
  margin-top: 5px;
}
</style>
