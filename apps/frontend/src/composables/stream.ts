import sessionStore from '@/store/sessionStore'
import { v4 } from 'uuid'
export const throttle = (fn: Function, delay: number) => {
  let lastCall = 0
  return function (...args: any[]) {
    const now = new Date().getTime()
    if (now - lastCall < delay) {
      return
    }
    lastCall = now
    return fn(...args)
  }
}
export const parseChunk = (chunk: string) => {
  const postProcessData = JSON.parse(chunk)
  const item = {
    id: v4(),
    date: new Date().toLocaleString(),
    role: 'machine',
    content: postProcessData,
  }
  sessionStore().pushItemToCurrentSession(item)
}

export const decodeChunks = async (res: Response) => {
  if (res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      let chunk
      try {
        chunk = decoder.decode(value)
        parseChunk(chunk)
      } catch (e) {
        chunk = decoder.decode(value)
        const chunks = chunk.split('\n')
        chunks.forEach((ck) => ck && parseChunk(ck))
      }
    }
  }
}