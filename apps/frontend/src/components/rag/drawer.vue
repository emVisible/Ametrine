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
          <el-cascader
            class="w-full"
            size="large"
            v-model="defaultCollectionName"
            :options="options"
            @change="setNewCollectionName" />
        </el-card>
      </template>
    </el-drawer>
    <div class="duration-300 hover:scale-125">
      <Config theme="outline" size="28" fill="#6a89cc" class="cursor-pointer" @click="toggleDrawerShow" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { type OptionsType } from '../../../types/ui'
import { getCollectionNames } from '@/apis/collection'
import llmStore from '@/store/llmStore'
import { Config } from '@icon-park/vue-next'
const conf = llmStore()
const emit = defineEmits(['getConfig'])
const isDrawerShow = ref(false)
const collectionName = ref('')
const defaultCollectionName = ref('')
const cacheValue = ref('')
const options = ref<OptionsType[]>([])

const toggleDrawerShow = () => {
  isDrawerShow.value = !isDrawerShow.value
}

onBeforeMount(async () => {
  await getCollectionNames()
    .then((res) => res.json())
    .then((names) => {
      const res: OptionsType[] = []
      names.forEach((name: string) => {
        const optionItem: OptionsType = {
          label: name,
          value: name,
        }
        res.push(optionItem)
      })
      options.value = res
      collectionName.value = res[0].label
      cacheValue.value = res[0].label
    })
  const savedCollectionName = await llmStore().getDefaultCollectionName()
  defaultCollectionName.value = savedCollectionName || cacheValue.value
})
const setNewCollectionName = async (current: any) => {
  const name = (current as Record<number, string>)[0]
  await llmStore().updateDefaultCollectionName(name)
}
</script>
