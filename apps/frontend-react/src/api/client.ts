export const API_BASE = import.meta.env.VITE_API_URL ?? ''

export async function postJson(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed: ${response.status}`)
  }

  return response
}
