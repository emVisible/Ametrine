<template>
  <div class="pr-3">
    <el-drawer size="700px" v-model="isDrawerShow" direction="rtl" modal-class="bg-black">
      <template #header class="bg-bgMain">
        <h1 class="text-xl border-b-2 py-6 text-text-gentle">设置</h1>
      </template>
      <template #default>
        <div class="text-text-gentle">默认集合</div>
        <el-cascader
          class="w-full bg-bgAddition"
          size="large"
          v-model="defaultCollectionName"
          :options="options"
          @change="setNewCollectionName" />
        <el-switch
          style="--el-switch-on-color: #ffeaa7; --el-switch-off-color: #a29bfe"
          v-model="switchValue"
          @click="toggleTheme"
          :active-icon="SunOne"
          :inactive-icon="Moon" />
      </template>
    </el-drawer>
    <div class="duration-300 hover:scale-125">
      <Config theme="outline" size="28" :fill="currentFill" class="cursor-pointer" @click="toggleDrawerShow" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { type OptionsType } from '../../../types/ui'
import { getCollectionNames } from '@/apis/collection'
import { useTheme } from '@/composables/theme'
import llmStore from '@/store/llmStore'
import { Config, SunOne, Moon } from '@icon-park/vue-next'
const conf = llmStore()
const emit = defineEmits(['getConfig'])
const isDrawerShow = ref(false)
const collectionName = ref('')
const defaultCollectionName = ref('')
const cacheValue = ref('')
const options = ref<OptionsType[]>([])
const switchValue = ref(true)
const { theme, toggleTheme } = useTheme()
const currentFill = computed(() => {
  return theme.value === 'light' ? '#a29bfe' : '#ffc08d' // 不同模式返回不同颜色
})

const toggleDrawerShow = () => {
  isDrawerShow.value = !isDrawerShow.value
}

onMounted(async () => {
  const collections = (await getCollectionNames()).data

  const res: any = []
  collections.forEach((collectionName: string) => {
    const optionItem: OptionsType = {
      label: collectionName,
      value: collectionName,
    }
    res.push(optionItem)
  })
  options.value = res
  collectionName.value = res[0].label
  cacheValue.value = res[0].label

  console.log(collections)
  const savedCollectionName = await llmStore().getDefaultCollectionName()
  defaultCollectionName.value = savedCollectionName || cacheValue.value
})
const setNewCollectionName = async (current: any) => {
  const name = (current as Record<number, string>)[0]
  await llmStore().updateDefaultCollectionName(name)
}
</script>
<style scope lang="scss">
.el-drawer {
  @apply bg-bgMain;
}
.el-card {
  @apply bg-bgMain;
}
.el-input {
  @apply bg-bgMain;
}
</style>
