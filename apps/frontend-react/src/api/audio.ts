import { API_BASE } from './client'

type TranscriptionResponse = {
  code?: number
  message?: string
  data?: {
    text?: string
  }
  text?: string
}

export async function transcribeAudio(blob: Blob, signal?: AbortSignal) {
  const form = new FormData()
  form.append('file', blob, 'recording.webm')

  const response = await fetch(`${API_BASE}/api/audio/transcriptions`, {
    method: 'POST',
    body: form,
    signal,
  })
  if (!response.ok) throw new Error(await response.text())

  const payload = (await response.json()) as TranscriptionResponse
  return payload.data?.text ?? payload.text ?? ''
}

export async function synthesizeSpeech(input: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/api/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
    signal,
  })
  if (!response.ok) throw new Error(await response.text())

  return response.blob()
}
