<template>
  <div class="h-screen w-screen">
    <el-container class="h-full w-full bg-orange-50">
      <el-aside width="300px" class="h-full">
        <Vice></Vice>
      </el-aside>
      <el-main>
        <Main></Main>
      </el-main>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import Main from "@/components/rag/main.vue";
import Vice from "@/components/rag/side.vue";
</script>

<style scoped></style>
