<template>
  <div>
    <div class="grid md:grid-cols-4 gap-3 bg-gray-100">
    <el-card shadow="hover" class=" cursor-pointer " :body-style="{ padding: '20px' }" v-for="(card,index) of data"
      :key="index">
      <template #header>
        <div class="">
          <div class="flex justify-between items-center">
            {{ card.title }}
            <el-tag type="danger" size="small" effect="dark">月</el-tag>

          </div>
        </div>
      </template>
      <section class="flex mt-3 justify-between items-center">
        <span class="text-3xl">$ {{ card.price }}</span>
        <i :class="[card.icon, card.iconColor]" class=" text-4xl"></i>
      </section>
      <section class="flex justify-between items-center text-base mt-6">
        {{ card.totalTitle }}
        <span class="text-xs ">{{ card.total }}</span>
      </section>
    </el-card>
  </div>

  <div class=" mt-5 grid md:grid-cols-2  gap-3">
    <el-card shadow="always" :body-style="{ padding: '20px' }">
      <template #header>
      <div>
        <span>用户统计</span>
      </div>
      </template>
      <div id="echart1" class="h-72 w-full"></div>
    </el-card>


    <el-card shadow="always" :body-style="{ padding: '20px' }">
      <template #header>
      <div>
        <span>销售额</span>
      </div>
      </template>
      <div id="echart2" class="h-72 w-full"></div>
    </el-card>
  </div>
  </div>
</template>

<script lang="ts" setup>
import { nextTick, ref } from 'vue';
import {echart1,echart2} from './echart'
import * as echarts from 'echarts';
interface ICard {
  title: string,
  price: number,
  icon: string,
  iconColor: string,
  totalTitle: string,
  total: number
}
const data = ref<ICard[]>([
  { title: '总人数', price: 23434, iconColor: 'text-violet-500', icon: 'fab fa-affiliatetheme', total: 3095823, totalTitle: '总人数' },
  { title: '销售额', price: 437, iconColor: 'text-red-500', icon: 'fas fa-anchor', total: 564132, totalTitle: '总销售额' },
  { title: '订单数', price: 98465, iconColor: 'text-green-500', icon: 'fas fa-atom', total: 321215, totalTitle: '总订单数' },
  { title: '评论数', price: 2385, iconColor: ' text-cyan-500', icon: 'fab fa-bandcamp', total: 8645132, totalTitle: '总评论' },
])

nextTick(() => {
  // 基于准备好的dom，初始化echarts实例
  echarts.init(document.getElementById('echart1') as HTMLDivElement ).setOption(echart1);
  echarts.init(document.getElementById('echart2') as HTMLDivElement ).setOption(echart2 as any);
})
</script>

<style lang="scss">

</style>