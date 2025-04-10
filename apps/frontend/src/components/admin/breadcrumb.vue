<template>
  <div>
    <el-breadcrumb separator="/">
      <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
      <template v-if="route">
        <el-breadcrumb-item :to="{ path: '/' }" v-for="(r,index) of route.matched" :key="index" >
        {{ r.meta.menu?.title }}
      </el-breadcrumb-item>
      </template>
    </el-breadcrumb>
  </div>
</template>

<script setup lang="ts">
import menu from '@/composables/menu'
const route = menu.route.value
</script>

<style scoped>

</style>