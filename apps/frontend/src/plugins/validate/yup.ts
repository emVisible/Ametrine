import * as yup from 'yup'
yup.setLocale({
  mixed:{
    required:'${label}必须输入'
  },
  string:{
    email:"邮箱格式错误",
    min:'密码不可少于3位'
  }
})

export default yup