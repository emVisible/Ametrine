import os
import hashlib
import json
import redis as redis_lib
import re
from fastapi import Depends, UploadFile
from xinference.client.handlers import AudioModelHandle
from src.client import get_stt_handle, get_tts_handle


class AudioService:
    def __init__(
        self,
        stt_handle: AudioModelHandle,
        tts_handle: AudioModelHandle,
    ):
        self.stt = stt_handle
        self.tts = tts_handle
        self.cache = redis_lib.Redis(
            host="127.0.0.1", port=6379, db=1, decode_responses=False
        )
        static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "static")
        sample_path = os.path.join(static_dir, "sample.mp3")
        self.prompt_text = "我怎么在xinference的AudioModel的speech方法中传递prompt_latent？这个latent怎么来的？看一下文档"
        self.default_prompt_speech = None
        if os.path.exists(sample_path):
            with open(sample_path, "rb") as f:
                self.default_prompt_speech = f.read()

    # ─── ASR ───
    async def transcribe(self, file: UploadFile) -> str:
        content = await file.read()
        result = self.stt.transcriptions(audio=content)
        if isinstance(result, dict):
            return result.get("text", "")
        return str(result).strip()

    # ─── TTS ───
    def _cache_key(self, text: str, voice: str) -> str:
        content = json.dumps({"text": text, "voice": voice}, sort_keys=True)
        return f"tts:{hashlib.sha256(content.encode()).hexdigest()}"

    async def synthesize(self, text: str, voice: str = "32023") -> bytes:
        text = self._clean_text_for_tts(text)
        key = self._cache_key(text, voice)
        cached = self.cache.get(key)
        if cached:
            return cached

        result = self.tts.speech(
            input=text,
            voice=voice,
            response_format="wav",
            speed=1.32,
            prompt_text=self.prompt_text,
            prompt_speech=self.default_prompt_speech,
        )
        audio_bytes = result if isinstance(result, bytes) else result.get("audio", b"")

        if audio_bytes:
            self.cache.setex(key, 604800, audio_bytes)

        return audio_bytes

    def _clean_text_for_tts(self, text: str) -> str:
        """清洗文本，保留停顿标点，去掉 Markdown 和无意义符号"""

        # 1. 去掉 Markdown 标题符号（保留文字）
        text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)

        # 2. 去掉粗体和斜体标记（保留文字）
        text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
        text = re.sub(r"\*(.+?)\*", r"\1", text)
        text = re.sub(r"__(.+?)__", r"\1", text)
        text = re.sub(r"_(.+?)_", r"\1", text)

        # 3. 去掉 Markdown 链接 [text](url) → text
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)

        # 4. 去掉行内代码 `` code ``，保留文字
        text = re.sub(r"`([^`]+)`", r"\1", text)

        # 5. 去掉代码块（整段移除）
        text = re.sub(r"```[\s\S]*?```", "", text)

        # 6. 去掉 Markdown 列表符号（保留文字）
        text = re.sub(r"^[\s]*[-*+]\s+", "", text, flags=re.MULTILINE)
        text = re.sub(r"^[\s]*\d+\.\s+", "", text, flags=re.MULTILINE)

        # 7. 去掉 HTML 标签
        text = re.sub(r"<[^>]+>", "", text)

        # 8. 去掉表格符号（保留文字和空格）
        text = text.replace("|", " ").replace("---", " ")

        # 9. 多个换行合并为两个（保留段落间距）
        text = re.sub(r"\n{3,}", "\n\n", text)

        # 10. 去掉其余特殊符号，但保留中文标点和常用符号
        # 最后一步：保留字母、数字、中文、中文标点、英文标点、空格、换行
        # 去掉 emoji、特殊符号、箭头、装饰符号等
        text = re.sub(
            r"[^\u4e00-\u9fff\u3400-\u4dbf"  # 中文字符
            r"a-zA-Z0-9"  # 英文和数字
            r"\u3000-\u303f"  # CJK 标点符号（。，！？等）
            r"\uff00-\uffef"  # 全角符号
            r"\u2000-\u206f"  # 通用标点
            r"\.\,\!\?\;\:\"\'\(\)\-…—"  # 英文标点
            r"\s]",  # 空白字符
            "",
            text,
        )

        return text.strip()


def get_audio_service(
    stt_handle: AudioModelHandle = Depends(get_stt_handle),
    tts_handle: AudioModelHandle = Depends(get_tts_handle),
):
    return AudioService(stt_handle=stt_handle, tts_handle=tts_handle)
