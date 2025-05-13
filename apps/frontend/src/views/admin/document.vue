<template>
  <section class="flex flex-1 gap-6 flex-col">
    <div class="flex gap-2">
      <el-card class="flex-1 h-full">
        <template #header>
          <div class="card-header">
            <h3>Document Upload</h3>
          </div>
        </template>
        <div class="flex flex-col gap-2 mb-2">
          <el-segmented v-model="databaseName" :options="databases" :change="updateCurrentDatabase" />
          <el-segmented v-model="collectionName" :options="collections" :change="updateCurrentCollection" />
        </div>
        <UploadDocument :collectionName="collectionName" :databaseName="databaseName" />
      </el-card>
      <el-card class="flex-1" style="height: full; overflow-y: scroll">
        <template #header>
          <div class="flex items-center">
            <h2 class="mr-auto">文档</h2>
            <el-popover
              placement="top-start"
              class="rounded-full"
              title="提示"
              trigger="hover"
              content="'文档内容'列点击可浏览全部文档">
              <template #reference>
                <div class="flex justify-center items-center rounded-full h-3 w-3 bg-violet-400 p-2 text-xs text-white">
                  ?
                </div>
              </template>
            </el-popover>
          </div>
        </template>
        <div>
          <el-table :data="data" style="width: 100%" @cell-click="showEntireDoc" highlight-current-row>
            <el-table-column prop="name" label="隶属集合" />
            <el-table-column prop="id" label="ID" width="180" />
            <el-table-column prop="source" label="来源" width="180" />
            <el-table-column prop="document" label="文档内容" :overflow-tooltip="true" />
          </el-table>
        </div>
        <el-dialog v-model="showDocDialog" title="Tips" class="w-full min-h-full">
          <div class="h-full p-4">{{ currentDocument }}</div>
          <template #header>
            <div class="text-2xl border-b-2 p-4">
              {{ currentSource }}
            </div>
          </template>
        </el-dialog>
      </el-card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { getCollectionNames, getDocumentEntireContent } from '@/apis/collection'
import { getDatabases } from '@/apis/database'
import UploadDocument from '@/components/rag/uploadDocument.vue'
import llmStore from '@/store/llmStore'
interface CollectionDetailData {
  id: string
  name: string
  source: string
  document: string
}
const currentDocument = ref('')
const currentSource = ref('')
const docCollectionName = ref('')
const showDocDialog = ref(false)
const data = ref<CollectionDetailData[]>([])

const databases = ref<string[]>([])
const databaseName = ref('default')
const collections = ref<string[]>([])
const collectionName = ref('default')

const updateCurrentCollection = async (val: string) => {
  collectionName.value = val
  await llmStore().updateDefaultCollectionName(val)
}
const updateCurrentDatabase = async (val: string) => {
  databaseName.value = val
  await llmStore().updateDefaultDatabaseName(val)
}

async function showEntireDoc(row: any, column: any) {
  if (column.no == 3) {
    showDocDialog.value = true
    const document_id = row.id
    const collection_name = docCollectionName.value
    const document_source = row.source
    const document = await getDocumentEntireContent({
      document_id: document_id,
      collection_name: collection_name,
    }).then((res) => res.json())
    currentDocument.value = document
    currentSource.value = document_source
  } else {
    currentDocument.value = ''
    currentSource.value = ''
  }
}
const fetchDatabases = async () => {
  const res = (await getDatabases()).data
  databases.value.push(...res)
}
const fetchCollections = async (databaseName: string) => {
  const res = (
    await getCollectionNames({
      database_name: databaseName,
    })
  ).data
  collections.value = res
  await llmStore().updateDefaultCollectionName(res[0])
}
const syncCollectionName = async () => {
  const savedCollectionName = await llmStore().getDefaultCollectionName()
  try {
    collectionName.value = savedCollectionName!
  } catch (e) {
    ElMessage.error('请设置默认查询集合')
  }
}
onMounted(async () => {
  await fetchDatabases()
  await fetchCollections('default')
})
watch(llmStore(), syncCollectionName)
watch(databaseName, () => fetchCollections(databaseName.value))
</script>

<style scoped></style>
