<template>
  <div class="h-full flex flex-col p-4 bg-orange-100 border-r-2">
    <button class="add flex justify-center py-3 duration-300 rounded-full hover:bg-white mb-6" @click="createSession">
      <div class="flex items-center">
        <Newlybuild class="duration-300 icon translate-x-10" theme="filled" size="32" fill="#2d3436" />
        <div class="duration-300 ml-3 opacity-0">开启新对话</div>
      </div>
    </button>
    <section class="card py-3 flex-1 flex flex-col h-full overflow-y-scroll px-3 bg-orange-50 rounded-lg shadow-lg">
      <HistoryButton
        v-for="(session, index) in sessions"
        class="w-full pl-3 duration-300 rounded-md shadow-sm my-1 py-4 text-lg"
        :style="{ background: index == currentIndex ? '#aaa69d' : '', color: index === currentIndex ? '#f7f1e3' : '' }"
        @click="switchSession(index)">
        <template #title> 会话{{ index + 1 }} </template>
        <template #time>
          {{ session[session.length - 1]?.date }}
        </template>
        <template #length>
          {{ session.length + '条信息' }}
        </template>
        <template #delete>
          <delete-three @click="sessionStore().deleteSessionCurrent(index)" theme="outline" size="18" fill="#FA5C5C" />
        </template>
      </HistoryButton>
    </section>
    <section
      class="flex my-3 items-center py-2 px-3 bg-white rounded-full duration-300 cursor-pointer hover:bg-zinc-200">
      <el-dropdown class="w-full">
        <div class="w-full flex items-center focus-visible:outline-none">
          <el-avatar :size="40" src="/images/user.png" />
          <div class="ml-3">
            {{ info.name || info.email || 'user' }}
          </div>
        </div>
        <template #dropdown>
          <el-dropdown-menu class="w-full">
            <el-dropdown-item v-if="!store.isStudent()" @click="background">进入后台</el-dropdown-item>
            <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </section>
  </div>
</template>

<script setup lang="ts">
import sessionStore from '@/store/sessionStore'
import { logout } from '@/utils/user'
import { DeleteThree, Newlybuild } from '@icon-park/vue-next'
import HistoryButton from './historyButton.vue'
import userStore from '@/store/userStore'
import { UserType } from '@/apis/user'
import { useRouter } from 'vue-router'
import store from '@/utils/store'
const info = ref<UserType>({ name: '', email: '', id: 0, permissions: [] })
const router = useRouter()
onMounted(() => {
  info.value = userStore().getUserInfo()
})

const currentIndex = ref(await sessionStore().getSessionIndex())
watch(await sessionStore(), async () => (currentIndex.value = await sessionStore().getSessionIndex()))
const sessions = ref(await sessionStore().getSessions())
const createSession = async () => {
  sessionStore().createSession([])
}
const switchSession = async (index: number) => {
  const session = sessionStore()
  const storeIndex = await session.setSessionIndex(index)
  if (storeIndex === index) {
    session.setFlush()
  }
}
const background = () => {
  router.push('/admin/workbench')
}
</script>

<style scoped lang="scss">
.add {
  &:hover div {
    opacity: 1;
  }

  &:hover .icon {
    transform: translateX(-1rem);
  }
}

.el-button + .el-button {
  margin-left: 0px;
}

.el-card__body .el-button {
  padding: 24px;
}

.card::-webkit-scrollbar-track {
  background-color: #b8bfc259;
  border-radius: 10px;
}

.card::-webkit-scrollbar {
  width: 5px;
  background-color: #f1f1f1;
}

.card::-webkit-scrollbar-thumb {
  background-color: #c4c4c4;
  border-radius: 10px;
}
</style>
