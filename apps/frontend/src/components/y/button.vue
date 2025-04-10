<template>
  <div>
    <button class="y_button mt-16">
      <slot></slot>
    </button>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.y_button {
  @apply bg-violet-700 text-white w-full py-2 rounded-md hover:bg-violet-600 duration-300;
}
</style>
