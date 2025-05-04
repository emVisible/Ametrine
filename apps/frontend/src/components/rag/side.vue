<template>
  <div class="h-full flex flex-col p-4 bg-bgVice">
    <section class="flex items-center justify-center mb-4">
      <img src="/images/banner.png" alt="" class="w-32 mr-auto" />
      <button class="add flex justify-center p-2 duration-300 rounded-full hover:bg-bgAddition" @click="createSession">
        <div class="flex items-center">
          <Newlybuild class="duration-300 icon" theme="filled" size="32" :fill="currentFill" />
        </div>
      </button>
    </section>
    <section class="card py-3 flex-1 flex flex-col h-full overflow-y-scroll px-3 bg-bgVice rounded-lg">
      <HistoryButton
        v-for="(session, index) in sessions"
        class="w-full pl-3 duration-300 rounded-md shadow-sm my-1 py-4 text-lg text-text-gentle"
        :class="{ 'bg-bgReverse shadow-lg': index === currentIndex, 'text-heavy': index === currentIndex }"
        @click="switchSession(index)">
        <template #title>{{session.title}} </template>
        <template #time>
          {{ session.history[session.history.length - 1]?.date }}
        </template>
        <template #length>
          {{ session.history.length + '条信息' }}
        </template>
        <template #delete>
          <delete-three @click="sessionStore().deleteSessionCurrent(index)" theme="outline" size="18" fill="#FA5C5C" />
        </template>
      </HistoryButton>
    </section>
    <section class="flex items-center p-2 bg-bgVice rounded-full duration-300 cursor-pointer hover:bg-bgAddition">
      <el-dropdown trigger="click" class="w-full">
        <div class="w-full flex focus-visible:outline-none items-center justify-between">
          <section class="flex items-center">
            <el-avatar :size="40" src="/images/user.png" />
            <div class="ml-3 text-text-gentle">
              {{ info.name || info.email || 'user' }}
            </div>
          </section>
          <el-switch
            style="--el-switch-on-color: #ffeaa7; --el-switch-off-color: #a29bfe"
            v-model="switchValue"
            @click.stop="themeStore.toggleTheme"
            :active-icon="SunOne"
            :inactive-icon="Moon" />
        </div>
        <template #dropdown>
          <el-dropdown-menu class="w-full setting-menu">
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
import { DeleteThree, Newlybuild, SunOne, Moon } from '@icon-park/vue-next'
import HistoryButton from './historyButton.vue'
import userStore from '@/store/userStore'
import { UserType } from '@/apis/user'
import { useRouter } from 'vue-router'
import store from '@/utils/store'
import { useThemeStore } from '@/store/themeStore'
const themeStore = useThemeStore()
const switchValue = ref(themeStore.theme === 'light' ? true : false)
const currentFill = computed(() => (themeStore.theme === 'light' ? '#6b7280' : '#9ca3af'))
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



.el-button + .el-button {
  margin-left: 0px;
}

.el-card__body .el-button {
  padding: 24px;
}
</style>
