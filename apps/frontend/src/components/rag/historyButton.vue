<template>
  <button class="relative flex flex-col text-left py-2 transition-[.3s] hover:bg-bgAddition" @dblclick="rename">
    <div class="w-full flex items-center">
      <p class="pl-1">
        <slot v-if="!showInput" name="title" :class="{ hidden: showInput }"></slot>
        <input v-if="showInput" v-model="input" type="text" class="w-3/4" @focusout="reset" @keydown="handleRename" />
      </p>
      <p class="ml-auto pr-1 text-sm">
        <slot name="length"></slot>
      </p>
    </div>
    <div>
      <p class="text-sm pl-1 pt-1">
        <slot name="time"></slot>
      </p>
    </div>
    <div class="absolute right-0 top-0 duration-300 opacity-10 hover:opacity-100">
      <slot name="delete"></slot>
    </div>
  </button>
</template>

<script setup lang="ts">
import useSessionStore from '@/store/sessionStore'

const sessionStore = useSessionStore()
const showInput = ref(false)
const input = ref('')

const rename = () => {
  showInput.value = !showInput.value
}
const reset = () => {
  sessionStore.renameCurrentSession(input.value)
  showInput.value = false
}
const handleRename = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    sessionStore.renameCurrentSession(input.value)
    showInput.value = false
  }
}
</script>

<style scoped></style>
