// src/stores/devicePrefs.ts
// 「这台设备/这个浏览器怎么表现」的偏好，和界面语言同一类：即时生效、不需要保存按钮、
// 换一台机器可以完全不同。服务端 preferences 装的是「账号跨设备要带走什么」，两者别混。
//
// 语音输入默认关闭：Web Speech API 并不是本地识别 —— Chrome 把音频送到 Google、
// Edge 送到微软，对一个主打「本地知识库」的应用来说，这个联网前提必须由用户明确同意。
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DevicePrefs {
  voiceInput: boolean;
  setVoiceInput: (next: boolean) => void;
}

export const useDevicePrefs = create<DevicePrefs>()(
  persist(
    (set) => ({
      voiceInput: false,
      setVoiceInput: (next) => set({ voiceInput: next }),
    }),
    { name: "ametrine-device-prefs" },
  ),
);

/** SpeechRecognition 是否存在于当前浏览器（不区分是否被用户启用）。 */
export function speechRecognitionAvailable(): boolean {
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}
