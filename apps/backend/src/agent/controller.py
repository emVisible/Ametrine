import asyncio
from asyncio import Semaphore

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from langchain.callbacks.base import AsyncCallbackHandler
from langchain_core.messages import AIMessage
from src.client import TaskType, get_semaphore
from src.llm.service import LLMService, get_llm_service
from src.middleware.tags import ControllerTag

from .service import AgentService, get_agent_service
from .tools.controller import route_agent_tools

route_agent = APIRouter(prefix="/agent", tags=[ControllerTag.agent])

route_agent.include_router(route_agent_tools)
agent_sem = Semaphore(10)



@route_agent.post("/chat")
async def communication(
    query: str,
    service: AgentService = Depends(get_agent_service),
    llm_service: LLMService = Depends(get_llm_service),
):
    async with get_semaphore(TaskType.AGENT):
        executor = service.get_agent_executor()
        iterator = executor.astream(input={"input": query or ""})
        step_response = llm_service.stream_by_step(iterator)
        return StreamingResponse(
            content=step_response,
            media_type="text/event-stream",
            status_code=200,
        )
