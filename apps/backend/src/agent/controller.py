from asyncio import Semaphore

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from src.client import TaskType, get_redis, get_semaphore
from src.middleware.tags import ControllerTag

from .service import AgentService, get_agent_service
from .tools.controller import route_agent_tools

route_agent = APIRouter(prefix="/agent", tags=[ControllerTag.agent])

route_agent.include_router(route_agent_tools)
agent_sem = Semaphore(10)


@route_agent.post("/chat")
async def communication(query: str, service: AgentService = Depends(get_agent_service)):
    stream = False
    async with get_semaphore(TaskType.AGENT):
        response = await service.get_agent_executor().ainvoke(
            input={"input": query or ""}, config={"stream": stream}
        )
        if stream:
            return StreamingResponse(response)
        return response
