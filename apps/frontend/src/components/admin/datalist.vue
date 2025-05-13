<template>
  <el-card class="h-full flex flex-col">
    <template #header>
      <div class="flex justify-between flex-nowrap">
        <div class="w-32">
          <y-button @click="openDialog" type="primary">{{ props.createTitle }}</y-button>
        </div>
        <div class="flex">
          <y-input v-model="query"></y-input>
          <div class="w-1/2">
            <y-button @click="search">Search</y-button>
          </div>
        </div>
      </div>
    </template>
    <slot/>
    <template #footer v-if="!props.hiddenFooter">
      <el-pagination layout="prev, pager, next" :total="1000" />
    </template>
  </el-card>
</template>

<script setup lang="ts">
import searchStore from '@/store/searchStore'

const store = searchStore()
const props = defineProps({
  createTitle: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    default: '',
  },
  hiddenFooter: {
    type: Boolean,
    default: false,
  }
})
const query = ref('')
const emit = defineEmits<{
  (e: 'openDialog'): void
  (e: 'search'): void
}>()

const openDialog = () => {
  emit('openDialog')
}

const search = async () => {
  switch (props.type) {
    case 'tenant':
      await store.updateTenantParams(query.value)
      break
    case 'database':
      await store.updateDatabaseParams(query.value)
      break
    case 'collection':
      await store.updateCollectionParams(query.value)
      break
    default:
      break
  }
  await emit('search')
}
</script>

<style lang="scss">
.el-card__body {
  height: 100%;
}
</style>
