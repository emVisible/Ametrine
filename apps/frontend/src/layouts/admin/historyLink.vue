<template>
  <div
    class="hidden md:block bg-gray-50 border-t border-b p-5 shadow-sm"
    v-show="menuService.history.value.length"
  >
    <div class="grid grid-flow-col gap-2 justify-start">
      <div
        v-for="menu_ of menuService.history.value"
        class="flex items-center justify-between bg-white rounded-sm py-2 border shadow-sm px-3 text-sm text-gray-600 duration-200 hover:bg-violet-600 hover:text-white cursor-pointer"
        :class="{ 'bg-violet-600 !text-white': $route.name == menu_.route }"
      >
        <router-link :to="{ name: menu_.route }">{{ menu_.title }}</router-link>
        <!-- <i class="fas fa-times )ml-1 cursor-pointer hover:text-red-500" @click="menuService.removeHistoryMenu(menu_"></i> -->
        <icon-close-small
          theme="outline"
          size="20"
          class="ml-1 cursor-pointer hover:text-red-500"
          @click="menuService.removeHistoryMenu(menu_)"
          :class="{'text-white':$route.name == menu_.title}"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
// import menuStore from '@/store/menuStore'
// const menu =  menuStore()
import menuService from '@/composables/menu'
// const links = ref<{ title: string }[]>([
//   { title: '编辑器' },
//   { title: '订单列表' },
//   { title: '用户管理' },
//   { title: '销售总额' },
//   { title: '编辑器' },
//   { title: '订单列表' },
//   { title: '用户管理' },
//   { title: '销售总额' },
//   { title: '编辑器' },
//   { title: '订单列表' },
//   { title: '用户管理' },
//   { title: '销售总额' },
// ])
</script>

<style scoped></style>
