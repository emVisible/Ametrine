<template>
  <div>
    <transition name="fade" mode="out-in">
      <RouterView></RouterView>
    </transition>
  </div>
</template>

<script lang="ts" setup></script>

<style lang="scss" scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity .9s ease-in-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
