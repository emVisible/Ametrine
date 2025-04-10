<template>
  <div class="notification">
    <i class="fas fa-align-justify" @click.stop="show = !show"></i>
    <el-tabs v-model="activeName" class="lists" v-show="show" @click.stop>
      <el-tab-pane label="站内通知" name="first">User</el-tab-pane>
      <a href="" class="">
        Adipisicing excepteur ea exercitation occaecat adipisicing. Ex
        consectetur aliquip consectetur laboris qui cupidatat veniam aliquip.
        Aliqua aliqua veniam ut nisi qui. Eu cupidatat dolore fugiat aliquip
        aliquip ut consequat laborum laboris Lorem.
      </a>
      <a href="" class="">
        Adipisicing excepteur ea exercitation occaecat adipisicing. Ex
        consectetur aliquip consectetur laboris qui cupidatat veniam aliquip.
        Aliqua aliqua veniam ut nisi qui. Eu cupidatat dolore fugiat aliquip
        aliquip ut consequat laborum laboris Lorem.
      </a>
      <a href="" class="">
        Adipisicing excepteur ea exercitation occaecat adipisicing. Ex
        consectetur aliquip consectetur laboris qui cupidatat veniam aliquip.
        Aliqua aliqua veniam ut nisi qui. Eu cupidatat dolore fugiat aliquip
        aliquip ut consequat laborum laboris Lorem.
      </a>
      <el-tab-pane label="系统通知" name="message">Task</el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref,nextTick } from 'vue'

const activeName = ref('site')
const show = ref(false)
nextTick(() => {
  document.documentElement.addEventListener('click', () => {
    show.value = false
  })
})
</script>

<style scoped lang="scss">
.notification {
  @apply relative;
  .lists {
    @apply absolute bg-white px-3 py-2  border rounded-md shadow-md right-[-60px] z-10 w-[300px] text-xs;
    a {
      @apply truncate overflow-hidden block border-b pb-2 my-2 hover:text-slate-500;
    }
  }
}
</style>
