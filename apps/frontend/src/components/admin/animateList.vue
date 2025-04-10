<template>
  <div class="animate-list">
    <TransitionGroup
      :tag="props.tag"
      appear
      @enter="enter"
      @before-enter="beforeEnter"
      name="animate"
    >
      <slot></slot>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import gsap from 'gsap'
import { RendererElement } from 'vue'
interface props {
  tag?: string
  duration?: number
  delay?: number
}
const props = withDefaults(defineProps<props>(), {
  tag: undefined,
  duration: 0.5,
  dealy: 0.2,
})
const beforeEnter = (el: RendererElement) => {
  gsap.set(el, {
    opacity: 0,
  })
}
const enter = (el: RendererElement) => {
  gsap.to(el, {
    opacity: 1,
    duration: props.duration,
    delay: el.dataset.index * (props.delay ?? 0),
  })
}
</script>

<style scoped lang="scss">
.animate-list {
  position: relative;
}
</style>
