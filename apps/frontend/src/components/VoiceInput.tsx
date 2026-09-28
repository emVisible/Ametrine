// src/components/VoiceInput.tsx
import { useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../api/asr";
import { useToast } from "../hooks/useToast";
import { MicIcon, Spinner, StopIcon } from "./icons";

interface VoiceInputProps {
  onResult: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInput({ onResult, disabled }: VoiceInputProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  // 组件卸载时释放麦克风，避免录音轨道泄漏
  useEffect(
    () => () => {
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("当前环境不支持录音，请通过 HTTPS 或 localhost 访问", "warning");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setElapsed(0);
        if (chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          if (text) onResult(text);
          else toast("没有识别到有效语音", "info");
        } catch (error) {
          toast(
            `语音识别失败：${error instanceof Error ? error.message : "未知错误"}`,
            "error",
          );
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      setRecording(true);
    } catch {
      toast("需要麦克风权限才能使用语音输入", "warning");
    }
  };

  if (transcribing) {
    return (
      <button
        type="button"
        disabled
        title="正在识别"
        aria-label="正在识别"
        className="a-btn a-btn-ghost shrink-0 !px-1.5"
      >
        <Spinner className="h-4 w-4" />
      </button>
    );
  }

  if (recording) {
    return (
      <button
        type="button"
        onClick={() => recorderRef.current?.stop()}
        title="停止录音"
        aria-label={`录音中 ${elapsed} 秒，点击停止`}
        className="a-btn shrink-0 !px-2 border-danger-border bg-danger-soft text-danger hover:bg-danger-soft"
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
        </span>
        <StopIcon className="h-3.5 w-3.5" />
        <span className="text-[11px] tnum">
          {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
          {String(elapsed % 60).padStart(2, "0")}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      title="语音输入"
      aria-label="语音输入"
      className="a-btn a-btn-ghost shrink-0 !px-1.5"
    >
      <MicIcon className="h-4 w-4" />
    </button>
  );
}
