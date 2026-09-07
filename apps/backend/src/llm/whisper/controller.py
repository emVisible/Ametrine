from fastapi import APIRouter, Depends, Body
from src.middleware.tags import ControllerTag
from .service import WhisperService, get_whisper_service

route_whisper = APIRouter(prefix="/whisper", tags=[ControllerTag.llm])


@route_whisper.get("/configs")
async def get_configs(service: WhisperService = Depends(get_whisper_service)):
    configs = await service.get_configs()
    return [
        {
            "mode": c.mode,
            "active_volumes": c.active_volumes,
            "max_depth": c.max_depth,
        }
        for c in configs
    ]


@route_whisper.post("/config/{mode}")
async def save_config(
    mode: str,
    active_volumes: list[str] = Body(...),
    max_depth: int = Body(3),
    service: WhisperService = Depends(get_whisper_service),
):
    config = await service.save_config(mode, active_volumes, max_depth)
    return {
        "mode": config.mode,
        "active_volumes": config.active_volumes,
        "max_depth": config.max_depth,
    }


@route_whisper.get("/preview/{mode}")
async def preview(mode: str, service: WhisperService = Depends(get_whisper_service)):
    return {"prompt": await service.get_whisper_prompt(mode)}


@route_whisper.get("/all")
async def all_whispers(service: WhisperService = Depends(get_whisper_service)):
    whispers = await service.get_all_whispers()
    return [
        {
            "id": w.id,
            "volume": w.volume,
            "sequence": w.sequence,
            "content": w.content,
            "depth": w.depth,
            "category": w.category,
            "is_active": w.is_active,
        }
        for w in whispers
    ]
