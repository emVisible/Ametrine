<template>
  <div class="pr-3">
    <el-drawer size="700px" v-model="isDrawerShow" direction="rtl">
      <template #header>
        <h1 class="text-xl border-b-2 py-6">设置</h1>
      </template>
      <template #default>
        <el-card class="w-full mb-6">
          <template #header>
            <div class="card-header">
              <h1 class="text-lg">默认查询集合</h1>
            </div>
          </template>
          <el-cascader class="w-full" size="large" v-model="defaultCollectionName" :options="options"
            @change="setNewCollectionName" />
          <el-switch v-model="switchValue" @click="toggleTheme" active-text="Light" inactive-text="Night" />
        </el-card>
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
import { Config } from '@icon-park/vue-next'
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
  return theme.value === 'light' ? '#a29bfe' : '#ffc08d'; // 不同模式返回不同颜色
});

const toggleDrawerShow = () => {
  isDrawerShow.value = !isDrawerShow.value
}

onMounted(async () => {
  const collections = await getCollectionNames().then(res => res.json())
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
