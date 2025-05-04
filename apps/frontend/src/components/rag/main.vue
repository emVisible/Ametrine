<template>
  <el-container class="h-[99%] w-full">
    <el-main class="main flex" id="main-window">
      <article v-if="!isEmpty" class="flex-1">
        <Message />
      </article>
      <article v-else class="flex-1 h-full flex flex-col justify-center items-center">
        <el-image src="/images/empty.png" fit="contain" :lazy="true" class="py-12 scale-150"></el-image>
        <h1 class="opacity-70 mt-6 text-text-gentle">当前还没有记录, 快去聊聊吧~</h1>
      </article>
    </el-main>
    <el-footer class="relative flex flex-col justify-center items-center mt-3">
      <section class="flex-1 flex w-3/4 justify-center items-center my-4">
        <div
          class="relative flex flex-1 h-[50px] bg-bgReverse items-center rounded-lg duration-300 shadow-sm hover:shadow-lg">
          <input
            class="bg-bgReverse rounded-lg text-text-heavy flex-[8] h-full pl-6 outline-none"
            type="text"
            v-model="userInput"
            placeholder="想了解点什么~"
            @keyup.enter="handleSubmit" />
          <section class="flex items-center text-text-gentle rounded-lg mr-2" @click="switchMode">
            <span
              v-if="chatMode"
              @click.stop="selectCollection"
              class="flex-1 min-w-8 p-2 flex justify-center items-center h-1/2 hover:bg-bgAddition cursor-pointer transition-all rounded-md"
              :class="chatMode ? 'opacity-100' : 'opacity-30'">
              {{ collectionName }}</span
            >
            <Components
              theme="filled"
              size="24"
              :fill="currentFill"
              class="p-2 hover:bg-bgAddition cursor-pointer transition-all rounded-md"
              :class="chatMode ? 'opacity-100' : 'opacity-30'" />
          </section>
          <el-dialog v-model="dialogFormVisible" title="选择集合" class="w-2/3 h-2/3">
            <el-segmented v-model="collectionName" :options="collections" :change="updateCurrentCollection" />
          </el-dialog>
        </div>
      </section>
      <section class="text-xs opacity-30 p-1 text-text-gentle">给出的建议可能会有错误, 请仔细鉴别</section>
    </el-footer>
  </el-container>
</template>

<script setup lang="ts">
import { chat, llmChat } from '@/apis/llm'
import { Components } from '@icon-park/vue-next'
import { ragChat } from '@/apis/rag'
import sessionStore from '@/store/sessionStore'
import { ElMessage } from 'element-plus'
import { v4 } from 'uuid'
import { onMounted, ref } from 'vue'
import Drawer from './drawer.vue'
import Message from './message.vue'
import llmStore from '@/store/llmStore'
import { useThemeStore } from '@/store/themeStore'
import { getCollectionNames } from '@/apis/collection'
const userInput = ref('')
const dialogFormVisible = ref(false)
const isEmpty = ref(await sessionStore().isSessionEmpty())
// false: 基础LLM模式; true: RAG模式
const chatMode = ref(false)
const collections = ref<string[]>([])
const collectionName = ref('')
const themeStore = useThemeStore()
const currentFill = computed(() => (themeStore.theme === 'light' ? '#ffc08d' : '#a29bfe'))
const updateCurrentCollection = async (val: string) => {
  collectionName.value = val
  dialogFormVisible.value = false
  await llmStore().updateDefaultCollectionName(val)
}
const syncCollectionName = async () => {
  const savedCollectionName = await llmStore().getDefaultCollectionName()
  try {
    collectionName.value = savedCollectionName!
  } catch (e) {
    ElMessage.error('请设置默认查询集合')
  }
}
const selectCollection = () => (dialogFormVisible.value = !dialogFormVisible.value)

onMounted(async () => {
  const res = (await getCollectionNames()).data
  collections.value.push(...res)
  await llmStore().updateDefaultCollectionName(res[0])
})
onMounted(syncCollectionName)
onMounted(themeStore.initTheme)
onMounted(() => {
  const mainWindow = document.getElementById('main-window')
  mainWindow?.scroll({ top: mainWindow?.scrollHeight })
})
watch(await llmStore(), syncCollectionName)
// 初始化滑动与流式渲染监听滑动
watch(await sessionStore(), async () => {
  const mainWindow = document.getElementById('main-window')
  mainWindow?.scroll({ top: mainWindow?.scrollHeight })
  isEmpty.value = await sessionStore().isSessionEmpty()
})
const switchMode = () => {
  chatMode.value = !chatMode.value
}
// 发起对话

const throttle = (fn: Function, delay: number) => {
  let lastCall = 0
  return function (...args: any[]) {
    const now = new Date().getTime()
    if (now - lastCall < delay) {
      return
    }
    lastCall = now
    return fn(...args)
  }
}

// Modify handleSubmit to use throttle
const handleSubmit = throttle(async (e: KeyboardEvent) => {
  const ipt = e.target as HTMLInputElement
  userInput.value = ipt.value
  try {
    await sessionStore()
      .updateCurrentSession({
        id: v4(),
        content: JSON.stringify({
          content: ipt.value,
        }),
        role: 'user',
        date: new Date().toLocaleString(),
      })
      .then(async () => {
        await sessionStore().updateCurrentSession({
          date: new Date().toLocaleString(),
          id: v4(),
          role: 'machine',
          content: '...',
        })
      })
      .then(dispatch)
  } catch (e) {
    console.error(e)
  }
  userInput.value = ''
}, 1000) // 1000ms (1 second) throttle delay
// const handleSubmit = async (e: KeyboardEvent) => {
//   const ipt = e.target as HTMLInputElement
//   userInput.value = ipt.value
//   try {
//     await sessionStore()
//       .updateCurrentSession({
//         id: v4(),
//         content: JSON.stringify({
//           content: ipt.value,
//         }),
//         role: 'user',
//         date: new Date().toLocaleString(),
//       })
//       .then(async () => {
//         await sessionStore().updateCurrentSession({
//           date: new Date().toLocaleString(),
//           id: v4(),
//           role: 'machine',
//           content: '...',
//         })
//       })
//       .then(dispatch)
//   } catch (e) {
//     console.error(e)
//   }
//   userInput.value = ''
// }

const dispatch = async () => {
  const de = await sessionStore().getCurrentSession(await sessionStore().getSessionIndex())
  const histories: string[] = []
  de?.forEach((item) => {
    if (item.role === 'user') {
      histories.push(JSON.parse(item.content).content)
    } else {
      if (item.content !== '...') histories.push(item.content)
    }
  })
  const start = histories.length - 4 >= 0 ? histories.length - 4 : 0
  const slice = histories.slice(start, histories.length - 1)
  handleStream(slice)
}

// 放入本地缓存 && 流式结果
const parseChunk = (chunk: string) => {
  const postProcessData = JSON.parse(chunk)
  const item = {
    id: v4(),
    date: new Date().toLocaleString(),
    role: 'machine',
    content: postProcessData,
  }
  sessionStore().pushItemToCurrentSession(item)
}

const handleStream = async (slice: string[]) => {
  const res = await chat({
    prompt: userInput.value,
    system_prompt: '',
    mode: chatMode.value ? 'rag' : 'llm',
    collection_name: collectionName.value,
    chat_history: [
      {
        role: 'user',
        content: `这些是我想要知道的信息: ${userInput.value}.`,
      },
      {
        role: 'user',
        content: `这些是可参考的信息: ${slice}.`,
      },
    ],
  })
  if (res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let chunk
      try {
        chunk = decoder.decode(value)
        parseChunk(chunk)
      } catch (e) {
        chunk = decoder.decode(value)
        const chunks = chunk.split('\n')
        chunks.forEach((ck) => ck && parseChunk(ck))
      }
    }
    ElNotification({
      title: '回答完毕',
      position: 'top-right',
    })
  }
}
</script>

<style scoped lang="scss">
.main {
  min-width: 640px;
}

.main::-webkit-scrollbar-track {
  background-color: #b8bfc259;
  border-radius: 10px;
}

.main::-webkit-scrollbar {
  width: 5px;
  background-color: #f1f1f1;
}

.main::-webkit-scrollbar-thumb {
  background-color: #c4c4c4;
  border-radius: 10px;
}

.el-segmented {
  --el-segmented-item-selected-color: var(--color-ametrine);
  --el-segmented-item-selected-bg-color: var(--corlor-bg-main);
  --el-border-radius-base: 16px;
}
</style>
