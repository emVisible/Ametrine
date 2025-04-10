<template>
  <div class="h-screen w-screen admin grid md:grid-cols-[auto_1fr]">
    <menu-component/>
    <div class="content bg-gray-100 grid grid-rows-[auto_1fr]">
      <div class>
        <navbar />
        <history-link />
      </div>
      <div class="relative m-3 overflow-y-auto">
        <router-view #default="{ Component }">
          <Transition
            appear
            class="animate__animated"
            :enter-active-class="route.meta.enterClass??'animate__fadeInRight'"
            :leave-active-class="route.meta.leaveClass ?? 'animate__fadeOutLeft'">
            <component :is="Component" class="absolute w-full "></component>
          </Transition>
        </router-view>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import menuComponent from './admin/menu.vue'
import navbar from './navbar.vue';
import historyLink from './admin/historyLink.vue'
import { useRoute } from 'vue-router';
import { watch } from 'vue';
import menu from '@/composables/menu'
const route = useRoute()
watch(route,()=>{
  menu.addHistoryMenu(route)
},{immediate:true})


</script>

<style scoped lang="scss">

</style>
<script lang="ts">
export default {
  route: { meta: { auth: true } }
}
</script>