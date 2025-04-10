<template>
  <div class="flex">
    <el-avatar v-if="role === 'user'" :size="40" src="/images/user.png" />
    <el-avatar v-else :size="40" src="/images/robot.png" />
    <div class="flex flex-col w-full pl-3">
      <div class="flex">
        <div class="font-semibold">
          <slot name="name"></slot>
        </div>
        <div class="ml-auto">
          <slot name="date"></slot>
        </div>
      </div>
      <div
        class="content bg-orange-100 w-full rounded-lg px-6 my-4 shadow-lg break-words break-all p-4 overflow-hidden">
        <slot name="content"></slot>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps(['role'])
const role = ref(props.role)

</script>

<style lang="scss">
.content {
  div {
    p {
      @apply py-1;
    }
  }
}
</style>
