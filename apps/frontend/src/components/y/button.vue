<template>
  <button class="y_button">
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
defineProps({
  size: {
    type: String,
    default: 'default',
  },
})
</script>

<style scoped>
.y_button {
  @apply bg-violet-700 text-white w-full py-2 rounded-md hover:bg-violet-600 duration-300;
}
</style>
