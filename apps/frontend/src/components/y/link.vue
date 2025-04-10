<template>
  <router-link :to="path" class="y_text">{{title}}</router-link>
</template>

<script setup lang="ts">
const {path, title} = defineProps(['title', 'path'])

</script>

<style scoped>
.y_text {
  @apply text-xs text-gray-600
}
</style>