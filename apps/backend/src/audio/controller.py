from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from src.middleware.tags import ControllerTag
from .service import AudioService, get_audio_service

route_audio = APIRouter(prefix="/audio", tags=[ControllerTag.audio])


@route_audio.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    service: AudioService = Depends(get_audio_service),
):
    text = await service.transcribe(file)
    return {"text": text}


@route_audio.post("/speech")
async def speech(
    text: str = Form(...),
    service: AudioService = Depends(get_audio_service),
):
    audio_bytes = await service.synthesize(text)
    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline"},
    )
