// src/components/VoiceInput.tsx
// 语音输入走浏览器自带的 Web Speech API：识别在本地/浏览器侧完成，
// 不再为了这一个按钮加载一个多 160+ 依赖、约 11 GB 权重的 ASR 模型。
// 浏览器不支持时整个按钮不渲染 —— 留下一个必然失败的控件更糟。
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/context";
import { useToast } from "../hooks/useToast";
import { useDevicePrefs } from "../stores/devicePrefs";
import { MicIcon, Spinner, StopIcon } from "./icons";

interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}

interface RecognitionResults {
  length: number;
  resultIndex: number;
  [index: number]: RecognitionResult;
}

interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResults;
}

interface RecognitionErrorEvent {
  error?: string;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface VoiceInputProps {
  onResult: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInput({ onResult, disabled }: VoiceInputProps) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  // 默认关闭：Web Speech 不是本地识别，要用户在设置里明确同意联网（见 stores/devicePrefs.ts）
  const enabled = useDevicePrefs((s) => s.voiceInput);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const gotTextRef = useRef(false);
  const supported = useMemo(() => !!recognitionCtor(), []);

  // 识别会话不随组件卸载自动结束：不收尾的话麦克风会一直被占着
  useEffect(
    () => () => {
      const rec = recRef.current;
      if (!rec) return;
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.abort();
      recRef.current = null;
    },
    [],
  );

  // 未在设置里开启、或浏览器根本没有识别能力时：不渲染，也不占输入行的一格
  if (!enabled || !supported) return null;

  const finish = () => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onend = null;
      rec.stop();
    }
    setListening(false);
    setStarting(false);
  };

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    // 识别语言跟着界面语言：中文界面下默认普通话，英文界面下 en-US
    rec.lang = lang === "en" ? "en-US" : "zh-CN";
    rec.continuous = true;
    rec.interimResults = false;
    gotTextRef.current = false;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const text = result[0]?.transcript.trim();
        if (!text) continue;
        gotTextRef.current = true;
        onResult(text);
      }
    };

    rec.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        toast(t("voice.denied"), "warning");
      } else if (code === "no-speech") {
        toast(t("voice.empty"), "info");
      } else if (code === "audio-capture") {
        toast(t("voice.needPermission"), "warning");
      } else if (code !== "aborted") {
        toast(t("voice.failed", { msg: code || t("errors.unknown") }), "error");
      }
    };

    rec.onend = () => {
      if (!gotTextRef.current) toast(t("voice.empty"), "info");
      recRef.current = null;
      setListening(false);
      setStarting(false);
    };

    recRef.current = rec;
    setStarting(true);
    try {
      rec.start();
      setStarting(false);
      setListening(true);
    } catch {
      // start() 在上一次会话还没落定时会抛错，直接收尾而不是假装在录音
      rec.abort();
      recRef.current = null;
      setStarting(false);
    }
  };

  if (starting) {
    return (
      <button
        type="button"
        disabled
        title={t("voice.transcribing")}
        aria-label={t("voice.transcribing")}
        className="a-btn a-btn-ghost shrink-0 !px-1.5"
      >
        <Spinner className="h-4 w-4" />
      </button>
    );
  }

  if (listening) {
    return (
      <button
        type="button"
        onClick={finish}
        title={t("voice.stop")}
        aria-label={t("voice.listening")}
        className="a-btn shrink-0 !px-2 border-danger-border bg-danger-soft text-danger hover:bg-danger-soft"
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
        </span>
        <StopIcon className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      title={t("voice.start")}
      aria-label={t("voice.start")}
      className="a-btn a-btn-ghost shrink-0 !px-1.5"
    >
      <MicIcon className="h-4 w-4" />
    </button>
  );
}
