<template>
  <section class="flex flex-col sm:px-2 md:px-16 lg:px-24 xl:px-28 2xl:px-32">
    <messageFrame class="my-4" :role="history?.role" v-for="history in data">
      <template #name> {{ history?.role === 'machine' ? '浙外小助手' : '你' }} </template>
      <template #date> {{ history?.date && history.date }} </template>
      <template class="py-4" v-if="history?.role === 'machine'" #content>
        <div v-html="md.render(history?.content)"></div>
      </template>
      <template v-else-if="history?.role === 'user'" #content>
        {{ JSON.parse(history?.content).content }}
      </template>
    </messageFrame>
  </section>
</template>

<script setup lang="ts">
import sessionStore, { HistoryType } from "@/store/sessionStore";
import { md } from "@/utils/md";
import messageFrame from "./messageFrame.vue";
let data = ref<HistoryType[]>(
  sessionStore().getCurrentSession(sessionStore().currentIndex) as any
);
watch(await sessionStore(), async () => {
  data.value = (await sessionStore().getCurrentSession(
    sessionStore().currentIndex
  )) as any;
});

sessionStore().setFlush();
</script>

<style scoped></style>./md
