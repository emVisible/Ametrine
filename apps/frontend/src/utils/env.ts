import _ from 'lodash'
const envs: any = _.cloneDeep(import.meta.env)

Object.entries(import.meta.env as Record<string, any>).forEach(([key, value]) => {
  if (value == 'true' || value == 'false') {
    envs[key] = value == 'true' ? true : false
  }
  else if (/^\d+$/.test(value)) {
    envs[key] = Number(value)
  }
  else if (value == 'null') envs[key] == null
  else if (value == 'undefined') envs[key] = undefined
  else {
    envs[key] = value
  }
})
export default envs as ImportMetaEnv