import httpx
from fastapi import HTTPException, UploadFile
from src.config import (
    xinference_stt_model_id,
    xinference_tts_model_id,
    xinference_vice_addr,
)

from .dto import SpeechRequest


class AudioService:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    async def transcribe(self, file: UploadFile):
        contents = await file.read()
        files = {
            "file": (
                file.filename or "audio.wav",
                contents,
                file.content_type or "application/octet-stream",
            )
        }
        data = {"model": xinference_stt_model_id}
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{self.base_url}/v1/audio/transcriptions",
                data=data,
                files=files,
            )
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        return response.json()

    async def speech(self, dto: SpeechRequest) -> bytes:
        payload = {
            "model": xinference_tts_model_id,
            "input": dto.input,
            "voice": dto.voice,
            "response_format": dto.response_format,
            "speed": dto.speed,
        }
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{self.base_url}/v1/audio/speech",
                json=payload,
            )
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        return response.content


def get_audio_service():
    return AudioService(base_url=xinference_vice_addr)
