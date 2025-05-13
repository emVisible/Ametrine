<template>
  <form class="bg-gradient-to-r from-[#fab1a0] to-[#778beb] w-full h-screen p-0" @submit="onSubmit">
    <div class="w-3/5 h-4/5 bg-white md:grid grid-cols-2 rounded-md shadow-sm translate-y-32 md:translate-y-0">
      <div class="p-6 flex flex-col justify-between overflow-hidden">
        <div>
          <h2 class="mt-16 text-center text-gray-700 text-2xl font-bold">用户登陆</h2>
          <div class="mt-16">
            <yInput v-model="values.account" @input="validate"></yInput>
            <Error :error="errors.account"></Error>
            <yInput v-model="values.password" class="mt-5" @input="validate" :isPassword="true"></yInput>
            <Error :error="errors.password"></Error>
          </div>
          <YButton class="w-full mt-16">登录</YButton>
        </div>
        <div class="flex gap-3 justify-center mt-10">
          <y-link title="忘记密码" path="/404"></y-link>
          <y-link title="注册" path="/registry"></y-link>
        </div>
      </div>
      <div class="hidden md:block relative">
        <img src="/images/login.jpg" class="absolute h-full w-full object-cover" />
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import Error from '@/components/y/error.vue'
import v from '../../plugins/validate'
import { loginWrap } from '../../utils/user'
const { useForm, useFields, yup } = v

const schema = yup.object({
  account: yup
    .string()
    .required()
    .matches(/^\d{11}|.+@.+$/, '请输入邮箱')
    .label('账号'),
  password: yup.string().required().min(4, '密码不少于4位').label('密码'),
})
const { handleSubmit, values, errors, validate } = useForm({
  validationSchema: schema,
})

useFields(Object.keys(schema))
const onSubmit = handleSubmit(async (values: any) => {
  const loadingInstance = ElLoading.service({ fullscreen: true, background: '#bdc3c7a0' })
  loginWrap(values).then((r) => {
    if (r) {
      ElNotification({ title: '登录成功' })
    } else {
      ElNotification({ title: '登录失败', type: 'error' })
    }
    loadingInstance.close()
  })
})
</script>

<style lang="scss">
form {
  @apply bg-slate-300 h-screen flex justify-center items-start md:items-center p-5;
}
</style>
