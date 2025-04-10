<template>
  <div class="admin-menu" :class="{close:menuService.close.value}">
    <div class="menu bg-gray-800">
    <div class="logo">
      <span class="w-full flex justify-center text-center">ZISU QA Assistant</span>
    </div>
    <!-- 菜单 -->
    <div class="container">
      <dl class v-for="(menu_, index) of menuService.menus.value" :key="index">
        <dt :class="{'w-[200px]':!menuService.close.value}" @click="menuService.toggleParentMenu(menu_)">
          <section class>
            <!-- <i :class="menu_.icon" class="mr-2 text-2xl"></i> -->
            <component :is="icons[menu_.icon!]" class="mr-2 text-2xl"></component>
            <span class="text-md">{{ menu_.title }}</span>
          </section>
          <section>
            <i class="fas fa-angle-down cursor-pointer duration-300 " :class="{ 'rotate-180': menu_.isClick }"></i>
          </section>
        </dt>
        <dd :class="!menu_.isClick || menuService.close.value ? 'hidden' : 'block'">
          <div  :class="{ active: cMenu.isClick }" v-for="(cMenu, key) of menu_.children" :key="key"
          @click="$router.push({ name: cMenu.route })">{{ cMenu.title }}</div>
        </dd>
      </dl>
    </div>
    </div>
    <div class="bg block md:hidden" @click="menuService.toggleState"></div>
  </div>
</template>

<script setup lang="ts">
import menuService from '@/composables/menu'
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import * as icons from '@icon-park/vue-next'
const route = useRoute()
watch(route, () => menuService.setCurrentMenu(route), { immediate: true })

</script>

<style lang="scss" scoped>
.admin-menu {
  @apply z-20;
.menu {
  @apply h-full ;
  .logo {

    @apply text-gray-300 flex items-center p-4;
  }

  .container {
    dl {
      @apply text-gray-300 text-sm relative p-4 ;

      dt {
        @apply text-sm px-3 flex justify-between  items-center cursor-pointer;

        section {
          @apply flex justify-center items-center text-lg;

          i {
            @apply mr-2 text-sm;
          }
        }
      }

      dd{
        div {
        @apply pl-4 py-3 my-2 text-white rounded-md cursor-pointer duration-300 hover:bg-violet-600 bg-gray-700;

        &.active {
          @apply bg-violet-700;
        }
      }
      }
    }
  }

}
}

@media screen and (min-width: 768px) {
  .admin-menu{
  &.close {

  .menu {
      width: auto;

      .logo {
        @apply justify-center ;
        i{
          @apply mr-0;
        }
        span {
          @apply hidden;
          &.i-icon{
                  @apply block mr-0;
                }
        }
      }

      .container {
        dl {
          dt {
            @apply flex justify-center;

            section {
              span {
                @apply hidden;
                &.i-icon{
                  @apply block mr-0;
                }
              }

              i {
                @apply mr-0
              }

              &:nth-of-type(2) {
                @apply hidden;
              }
            }
          }
          &:hover{
            dd{
              @apply block absolute left-full top-[0px] w-[200px] bg-gray-700 ;
              div {
                              @apply rounded-none m-0;

              }
          }
          }
        }

      }
    }
    }
  }
}

@media screen and (max-width:768px) {
  .admin-menu {
    @apply h-screen w-[200px] absolute left-0 top-0 z-10;
    .menu {
    @apply  h-full z-50 absolute;


  }
  .bg {
      @apply bg-gray-100 z-40 opacity-75 w-screen h-screen absolute left-0 top-0;
    }
    &.close {
      @apply hidden;
    }
  }
}
</style>