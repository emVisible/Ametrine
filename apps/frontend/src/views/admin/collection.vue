<template>
  <div class="flex flex-col gap-6">
    <section class="flex flex-1">
      <el-card class="flex-1">
        <template #header>
          <div class="card-header">
            <h2>集合 - Collection</h2>
          </div>
        </template>
        <div class="header-container">
          <el-button @click="openDialog" type="primary">创建集合</el-button>
        </div>

        <el-table :data="collections" style="width: 100%">
          <el-table-column prop="id" label="ID" />
          <el-table-column prop="name" label="集合名称" />
          <el-table-column prop="vest_database" label="归属数据库" />
          <el-table-column prop="vest_tenant" label="归属学院 (英)" />
        </el-table>
      </el-card>

      <el-dialog title="创建新集合" v-model="isDialogVisible" width="500" @close="resetDialogForm" style="z-index: 9999">
        <el-form :model="newCollection">
          <el-form-item label="集合名称" required>
            <el-input v-model="newCollection.name" />
          </el-form-item>
          <el-form-item label="归属数据库" required>
            <el-input v-model="newCollection.database_name" />
          </el-form-item>
          <el-form-item label="归属学院 (英)" required>
            <el-input v-model="newCollection.tenant_name" />
          </el-form-item>
          <el-form-item label="额外信息" required>
            <el-input v-model="newCollection.metadata" />
          </el-form-item>
        </el-form>

        <template #footer>
          <el-button @click="isDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="createNewCollection">创建</el-button>
        </template>
      </el-dialog>
    </section>
    <section class="flex flex-1 gap-6">
      <el-card class="flex-1 h-full">
        <template #header>
          <div class="card-header">
            <h3>上传文档</h3>
          </div>
        </template>
        <div class="mb-3 flex">
          <div class="break-keep flex items-center mr-4">选择集合</div>
          <el-select v-model="uploadCollectionName" placeholder="Select" size="large">
            <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>
        <UploadDocument :collectionName="uploadCollectionName" />
      </el-card>
      <el-card class="flex-1" style="height:full; overflow-y:scroll;">
        <template #header>
          <div class="flex items-center">
            <h2 class="mr-auto">文档</h2>
            <el-popover placement="top-start" class="rounded-full" title="提示" trigger="hover"
              content="'文档内容'列点击可浏览全部文档">
              <template #reference>
                <div class="flex justify-center items-center rounded-full h-3 w-3  bg-violet-400 p-2 text-xs text-white">?</div>
              </template>
            </el-popover>
          </div>
        </template>
        <div>
          <div class="mb-3 flex">
            <div class="break-keep flex items-center mr-4">选择集合</div>
            <el-select v-model="docCollectionName" placeholder="Select" size="large">
              <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </div>
          <el-table :data="data" style="width: 100%" @cell-click="showEntireDoc" highlight-current-row>
            <el-table-column prop="name" label="隶属集合" />
            <el-table-column prop="id" label="ID" width="180" />
            <el-table-column prop="source" label="来源" width="180" />
            <el-table-column prop="document" label="文档内容" :overflow-tooltip="true" />
          </el-table>
        </div>
        <el-dialog v-model="showDocDialog" title="Tips" class="w-full min-h-full ">
          <div class="h-full p-4">{{ currentDocument }}</div>
          <template #header>
            <div class="text-2xl border-b-2 p-4">
              {{ currentSource }}
            </div>
          </template>
        </el-dialog>
      </el-card>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getCollections, createCollection, getCollectionByName, getDocumentEntireContent } from '@/apis/collection'
import UploadDocument from '@/components/rag/uploadDocument.vue'
import { type OptionsType } from '#/ui'
import { getCollectionsDetail } from '../../apis/collection'
interface CollectionType {
  id: string
  name: string
  database_name: string
  tenant_name: string
}

interface CollectionDetailData {
  id: string
  name: string
  source: string
  document: string
}

interface CollectionsDetail {
  metadata: {
    collection_name: string
  }
  data: CollectionDetailData[]
}
const docCollectionName = ref('')
const uploadCollectionName = ref('')
const data = ref<CollectionDetailData[]>([])
const options = ref<OptionsType[]>([])
const collections = ref<CollectionType[]>([])
const newCollection = ref({
  name: '',
  tenant_name: '',
  database_name: '',
  metadata: '',
})
const isDialogVisible = ref(false)
const showDocDialog = ref(false)
const currentDocument = ref('')
const currentSource = ref('')
onMounted(async () => {
  await fetchCollections()
})
watch(docCollectionName, setCollectionDetail)

async function setCollectionDetail() {
  const res: CollectionsDetail[] = await getCollectionsDetail().then((res) => res.json())
  let cursor = 0
  try {
    res.forEach((item, index) => {
      if (item.metadata.collection_name == docCollectionName.value) cursor = index
    })
  } catch (e) {
    ElNotification({ title: '获取失败', type: 'error' })
  }
  data.value = res[cursor].data
}
async function showEntireDoc(row: any, column: any) {
  if (column.no == 3) {
    showDocDialog.value = true
    const document_id = row.id
    const collection_name = docCollectionName.value
    const document_source = row.source
    const document = await getDocumentEntireContent({
      document_id: document_id,
      collection_name: collection_name
    }).then(res => res.json())
    currentDocument.value = document
    currentSource.value = document_source
  }
  else {
    currentDocument.value = ''
    currentSource.value = ''
  }
}

async function fetchCollections() {
  const response = await getCollections()
  const data: CollectionType[] = await response.json()
  collections.value = data
  const names: OptionsType[] = []
  data.forEach((item) => {
    const { name } = item
    const optionItem: OptionsType = {
      label: name,
      value: name,
    }
    names.push(optionItem)
  })
  options.value = names
}

function openDialog() {
  console.log('Dialog Opened')
  isDialogVisible.value = true
}

function resetDialogForm() {
  newCollection.value = {
    name: '',
    tenant_name: '',
    database_name: '',
    metadata: '',
  }
}

async function createNewCollection() {
  if (!newCollection.value.name || !newCollection.value.tenant_name || !newCollection.value.database_name) {
    return alert('请填写完整的信息')
  }
  const newData = newCollection.value
  const response = await createCollection({ ...newData, metadata: { descript: newData.metadata } })
  if (response.ok) {
    alert('集合创建成功')
    newCollection.value = { name: '', tenant_name: '', database_name: '', metadata: '' } // 清空表单
    fetchCollections() // 重新获取集合列表
    isDialogVisible.value = false // 关闭弹窗
  } else {
    alert('创建失败')
  }
}
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
