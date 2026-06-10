// src/components/SpeakButton.tsx
import { useState, useEffect, useCallback } from 'react'
import { synthesizeSpeech } from '../api/tts'

interface SpeakButtonProps {
  text: string
  voice?: string
  preload?: boolean
}

export default function SpeakButton({ text, voice, preload = true }: SpeakButtonProps) {
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cached, setCached] = useState(false)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)

  // 自动预加载：组件挂载后后台请求 TTS，缓存到 Redis
  useEffect(() => {
    if (!preload || !text) return
    let cancelled = false

    const preloadAudio = async () => {
      try {
        const a = await synthesizeSpeech(text)
        if (!cancelled) {
          setAudio(a)
          setCached(true)
        }
      } catch {
        // 预加载失败不提示，用户点击时再试
      }
    }

    // 延迟 500ms 再预加载，避免和流式渲染抢资源
    const timer = setTimeout(preloadAudio, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, voice, preload])

  // 组件卸载时释放音频资源
  useEffect(() => {
    return () => {
      if (audio) {
        audio.pause()
        audio.src = ''
      }
    }
  }, [audio])

  const handleSpeak = useCallback(async () => {
    if (playing || loading) return

    const speakText = text.length > 500 ? text.slice(0, 500) : text

    try {
      setLoading(true)
      const a = audio || await synthesizeSpeech(speakText)
      setAudio(a)
      setCached(true)
      setLoading(false)
      setPlaying(true)

      a.currentTime = 0
      a.play()
      a.onended = () => setPlaying(false)
      a.onerror = () => setPlaying(false)
    } catch (error) {
      console.error('TTS 失败:', error)
      setLoading(false)
    }
  }, [text, voice, audio, playing, loading])

  return (
    <button
      onClick={handleSpeak}
      disabled={loading}
      className="p-1 rounded hover:bg-gray-100 transition-colors flex-shrink-0"
      title={
        loading
          ? '生成语音中...'
          : playing
            ? '播放中...'
            : cached
              ? '已缓存，点击播放'
              : '朗读'
      }
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      ) : playing ? (
        <svg
          className="w-4 h-4 text-indigo-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
          />
        </svg>
      ) : (
        <div className="relative">
          <svg
            className={`w-4 h-4 ${cached ? 'text-green-600' : 'text-gray-500 hover:text-indigo-600'
              }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
          </svg>
          {cached && (
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white" />
          )}
        </div>
      )}
    </button>
  )
}