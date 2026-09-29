import os
import hashlib
import json
import redis as redis_lib
import re
from fastapi import Depends, UploadFile
from xinference_client.client.restful.restful_client import (
    RESTfulAudioModelHandle as AudioModelHandle,
)
from src.client import get_stt_handle


class AudioService:
    def __init__(
        self,
        stt_handle: AudioModelHandle,
    ):
        self.stt = stt_handle
        self.cache = redis_lib.Redis(
            host="127.0.0.1", port=6379, db=1, decode_responses=False
        )
        static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "static")
        sample_path = os.path.join(static_dir, "sample.mp3")
        self.prompt_text = ""
        self.default_prompt_speech = None
        if os.path.exists(sample_path):
            with open(sample_path, "rb") as f:
                self.default_prompt_speech = f.read()

    async def transcribe(self, file: UploadFile) -> str:
        content = await file.read()
        result = self.stt.transcriptions(audio=content)
        if isinstance(result, dict):
            return result.get("text", "")
        return str(result).strip()


def get_audio_service(stt_handle: AudioModelHandle = Depends(get_stt_handle)):
    return AudioService(stt_handle=stt_handle)
