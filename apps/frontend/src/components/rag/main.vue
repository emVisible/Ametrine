<template>
  <el-container class="h-[99%] w-full">
    <el-main class="main flex" id="main-window">
      <article v-if="!isEmpty" class="flex-1">
        <Message />
      </article>
      <article v-else class="flex-1 h-full flex flex-col justify-center items-center">
        <el-image src="/images/empty.png" fit="contain" :lazy="true" class="py-12 scale-150"></el-image>
        <h1 class="opacity-70 text-slate-600 mt-6">当前还没有记录, 快去聊聊吧~</h1>
      </article>
    </el-main>
    <el-footer class="relative flex flex-col justify-center items-center mt-3">
      <section class="flex-1 flex w-[850px] justify-center items-center my-4">
        <div
          class="relative flex flex-1 h-[50px] bg-bgReverse items-center rounded-lg duration-300 hover:shadow-md focus:shadow-md">
          <input class="bg-bgReverse rounded-lg text-text-heavy flex-[8] h-full pl-6 outline-none" type="text"
            v-model="userInput" placeholder="想了解点什么~" @keyup.enter="handleSubmit" />
          <span v-if="chatMode"
            class="cursor-default flex-1 flex justify-center items-center h-1/2 text-white bg-bgReverse rounded-lg mr-2 px-3">
            {{ collectionName }}</span>
          <Drawer class="absolute -left-12" />
        </div>
        <el-switch class="text-text-heavy" v-model="chatMode" inline-prompt
          style="margin-left: 12px; --el-switch-on-color:#ffc08d; --el-switch-off-color: #a29bfe " active-text="检索模式"
          width="100%" size="large" inactive-text="基础模式" />
      </section>
      <section class="text-xs opacity-30 p-1">给出的建议可能会有错误, 请仔细鉴别</section>
    </el-footer>
  </el-container>
</template>

<script setup lang="ts">
import { chat, llmChat } from '@/apis/llm'
import { ragChat } from '@/apis/rag'
import sessionStore from '@/store/sessionStore'
import { ElMessage } from 'element-plus'
import { v4 } from 'uuid'
import { onMounted, ref } from 'vue'
import Drawer from './drawer.vue'
import Message from './message.vue'
import llmStore from '@/store/llmStore'
const userInput = ref('')
const isEmpty = ref(await sessionStore().isSessionEmpty())
// false: 基础LLM模式; true: RAG模式
const chatMode = ref('基础模式')
const collectionName = ref('')

const syncCollectionName = async () => {
  const savedCollectionName = await llmStore().getDefaultCollectionName()
  try {
    collectionName.value = savedCollectionName!
  } catch (e) {
    ElMessage.error('请设置默认查询集合')
  }
}

onMounted(syncCollectionName)
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
// 发起对话
const handleSubmit = async (e: KeyboardEvent) => {
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
}

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
      position: 'bottom-right',
      showClose: false,
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

/* 定义滚动条滑块 */
.main::-webkit-scrollbar-thumb {
  background-color: #c4c4c4;
  /* 设置滑块背景色 */
  border-radius: 10px;
  /* 轨道边框圆角 */
}
</style>
