// src/api/tts.ts — 改为调 /audio/speech
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api'

export async function synthesizeSpeech(text: string): Promise<HTMLAudioElement> {
  const formData = new URLSearchParams()
  formData.append('text', text)
  const token = localStorage.getItem('auth-storage')
    ? JSON.parse(localStorage.getItem('auth-storage')!).state?.token
    : null

  const response = await fetch(`${API_BASE}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  })

  if (!response.ok) throw new Error(`语音合成失败: ${response.status}`)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.onended = () => URL.revokeObjectURL(url)
  return audio
}