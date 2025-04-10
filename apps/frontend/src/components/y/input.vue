<template>
  <input :type="isPassword ? 'password' : 'text'" class="y_input" :value="props.modelValue"
    @input="$emit('update:modelValue', ($event!.target! as any).value!)" />
</template>

<script setup lang="ts">
const props = defineProps({
  modelValue: String,
  isPassword: Boolean
});
</script>

<style scoped>
.y_input {
  @apply border border-gray-200 pl-3 placeholder:text-xs w-full rounded py-1 px-2 outline-none focus:ring-2 ring-offset-2 ring-purple-600 duration-300 focus:border-white;
}
</style>
