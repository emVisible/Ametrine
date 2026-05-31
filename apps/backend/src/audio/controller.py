from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from src.middleware.tags import ControllerTag

from .dto import SpeechRequest
from .service import AudioService, get_audio_service

route_audio = APIRouter(prefix="/audio", tags=[ControllerTag.audio])


@route_audio.post("/transcriptions", summary="[Audio] ASR transcription")
async def transcriptions(
    file: UploadFile = File(...),
    service: AudioService = Depends(get_audio_service),
):
    return await service.transcribe(file=file)


@route_audio.post("/speech", summary="[Audio] TTS speech")
async def speech(
    dto: SpeechRequest,
    service: AudioService = Depends(get_audio_service),
):
    content = await service.speech(dto=dto)
    media_type = "audio/mpeg" if dto.response_format == "mp3" else "application/octet-stream"
    return Response(content=content, media_type=media_type)
