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
          <el-dialog v-model="dialogFormVisible" title="Select Knowledge Base" class="w-2/3 h-2/3">
            <el-card>
              <template #header>
                <div>
                  <div v-if="!databaseName">暂无</div>
                  <el-segmented v-else v-model="databaseName" :options="databases" :change="updateCurrentDatabase" />
                </div>
              </template>
              <div v-if="!collectionName">暂无</div>
              <el-segmented v-else v-model="collectionName" :options="collections" :change="updateCurrentCollection" />
              <template #footer>
                <div v-if="!collectionName">暂无</div>
                <el-descriptions v-else :colomn="1" :row="1">
                  <el-descriptions-item label="Created Time">
                    {{ new Date(collectionDetail.created_timestamp) }}
                  </el-descriptions-item>
                  <el-descriptions-item label="Description">
                    {{ collectionDetail.description }}
                  </el-descriptions-item>
                </el-descriptions>
              </template>
            </el-card>
          </el-dialog>
        </div>
      </section>
      <section class="text-xs opacity-30 p-1 text-text-gentle">给出的建议可能会有错误, 请仔细鉴别</section>
    </el-footer>
  </el-container>
</template>

<script setup lang="ts">
import { getCollectionNames } from '@/apis/collection'
import { getDatabases } from '@/apis/database'
import { chat } from '@/apis/chat'
import llmStore from '@/store/llmStore'
import sessionStore from '@/store/sessionStore'
import { useThemeStore } from '@/store/themeStore'
import { Components } from '@icon-park/vue-next'
import { ElMessage } from 'element-plus'
import { v4 } from 'uuid'
import { onMounted, ref } from 'vue'
import Message from './message.vue'
import { getCollectionDetail } from '@/apis/collection'
import { parseReferences, throttle, decodeChunks } from '@/composables/stream'
import { getReferenceData } from '@/apis/rag'
interface CollectionDetail {
  description: string
  created_timestamp: string
}
const userInput = ref('')
const dialogFormVisible = ref(false)
const isEmpty = ref(await sessionStore().isSessionEmpty())
const chatMode = ref(false)
const collections = ref<string[]>([])
const databases = ref<string[]>([])
const collectionName = ref('default')
const collectionDetail = ref<CollectionDetail>({
  description: '',
  created_timestamp: '',
})
const databaseName = ref('default')
const themeStore = useThemeStore()
const currentFill = computed(() => (themeStore.theme === 'light' ? '#ffc08d' : '#a29bfe'))
const updateCurrentCollectionDetail = async () => {
  const detail = (
    await getCollectionDetail({
      collection_name: collectionName.value,
      database_name: databaseName.value,
    })
  ).data
  collectionDetail.value = detail
}
const updateCurrentCollection = async (val: string) => {
  collectionName.value = val
  await llmStore().updateDefaultCollectionName(val)
}
const updateCurrentDatabase = async (val: string) => {
  databaseName.value = val
  await llmStore().updateDefaultDatabaseName(val)
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
watch(databaseName, () => fetchCollections(databaseName.value))
watch(collectionName, async () => {
  await updateCurrentCollectionDetail()
})
watch(llmStore(), syncCollectionName)
watch(sessionStore(), async () => {
  const mainWindow = document.getElementById('main-window')
  mainWindow?.scroll({ top: mainWindow?.scrollHeight })
  isEmpty.value = await sessionStore().isSessionEmpty()
})

onMounted(async () => {
  fetchDatabases()
  fetchCollections('default')
})
onMounted(syncCollectionName)
onMounted(themeStore.initTheme)
onMounted(() => {
  const mainWindow = document.getElementById('main-window')
  mainWindow?.scroll({ top: mainWindow?.scrollHeight })
})
const switchMode = () => (chatMode.value = !chatMode.value)

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
}, 1000)

const dispatch = async () => {
  const session = await sessionStore().getCurrentSession(await sessionStore().getSessionIndex())
  const histories: string[] = []
  session?.forEach((item) => {
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

const handleStream = async (slice: string[]) => {
  const res = await chat({
    prompt: userInput.value,
    system_prompt: '',
    mode: chatMode.value ? 'rag' : 'llm',
    database_name: databaseName.value,
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
  await decodeChunks(res)
  if (chatMode.value) {
    const session_id = res.headers.get('X-Session-ID')!
    const references = (await getReferenceData(session_id)).data
    await parseReferences(references)
  }
  ElNotification({
    title: '回答完毕',
    position: 'top-right',
  })
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
