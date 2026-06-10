// src/api/asr.ts — 改为调 /audio/transcribe
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api'

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const formData = new FormData()
  formData.append('file', audioBlob, 'recording.wav')

  const token = localStorage.getItem('auth-storage')
    ? JSON.parse(localStorage.getItem('auth-storage')!).state?.token
    : null

  const response = await fetch(`${API_BASE}/audio/transcribe`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })

  if (!response.ok) throw new Error(`语音识别失败: ${response.status}`)

  const data = await response.json()
  return data.text || data.data?.text || ''
}