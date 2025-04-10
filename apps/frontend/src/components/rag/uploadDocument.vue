<template>
  <div>
    <el-upload drag :show-file-list="true" :on-change="onUploadChange"
      :action="'/api/vector_store/upload_single/' + collectionName" :on-error="handleError" multiple>
      <UploadLogs class="flex justify-center my-6" theme="outline" size="32" fill="#333" />
      <div class="el-upload__text"><em>将文件拖拽至此上传</em> 或<em>点击上传</em></div>
      <template #tip>
        <div class="el-upload__tip">支持格式: {{ supportFormat }}</div>
      </template>
    </el-upload>
  </div>
</template>

<script setup lang="ts">
import { UploadLogs } from '@icon-park/vue-next'
import { ElMessage } from 'element-plus'
const { collectionName } = defineProps(['collectionName'])

const selectedFile = ref<File | null>(null)
const supportFormat = '.docx .pdf .xls .xlsx .txt'
const handleError = () => {
  ElMessage.error('文档上传错误, 请检查选中集合或文档格式')
}

const onUploadChange = (file: any, fileList: any) => {
  if (!file) return
  selectedFile.value = file
}
</script>
<style scoped></style>
