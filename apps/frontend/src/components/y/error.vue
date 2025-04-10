<template>
  <div class="y_error" v-show="props.error">
    {{ props.error }}
  </div>
</template>

<script setup lang="ts">

const props = defineProps({
  error:String
})
</script>

<style scoped>
.y_error {
  @apply rounded-md bg-pink-600 text-white text-xs px-2 py-1 mt-3;
}
</style>
