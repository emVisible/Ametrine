import { useState, useRef } from 'react'
import { transcribeAudio } from '../api/asr'

interface VoiceInputProps {
  onResult: (text: string) => void
  disabled?: boolean
}

export default function VoiceInput({ onResult, disabled }: VoiceInputProps) {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (chunksRef.current.length === 0) return

        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecording(false)
        setTranscribing(true)

        try {
          const text = await transcribeAudio(audioBlob)
          if (text) onResult(text)
        } catch (error) {
          console.error('语音识别失败:', error)
        } finally {
          setTranscribing(false)
        }
      }

      mediaRecorder.start()
      setRecording(true)
    } catch (error) {
      console.error('无法访问麦克风:', error)
      alert('请允许麦克风权限后重试')
    }
  }


  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
  }

  if (transcribing) {
    return (
      <button
        disabled
        className="p-2 rounded-lg bg-gray-100 text-gray-400 flex-shrink-0"
        title="识别中..."
      >
        <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
      </button>
    )
  }

  if (recording) {
    return (
      <button
        onClick={stopRecording}
        className="p-2 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors flex-shrink-0 relative"
        title="停止录音"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 6v12h8V6H8z" />
        </svg>
        <span className="absolute -top-1 -right-1 w-3 h-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
      </button>
    )
  }

  return (
    <button
      onClick={startRecording}
      disabled={disabled}
      className="p-2 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      title="语音输入"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    </button>
  )
}