from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends
from src.middleware.tags import ControllerTag
from src.utils import require_roles

from .playwright import PlaywrightService, get_playwright_service
from .shell import ShellService, get_shell_service


@asynccontextmanager
async def lifespan(app):
    playwright_service = get_playwright_service()
    await playwright_service.init()
    yield
    await playwright_service.shutdown()


route_agent_tools = APIRouter(
    prefix="/tools", tags=[ControllerTag.agent_tools], lifespan=lifespan
)


@route_agent_tools.post("/shell")
async def use_shell(
    command: str,
    service: ShellService = Depends(get_shell_service),
    user=Depends(require_roles(["admin"])),
):
    return service.run(command)


@route_agent_tools.post("/playwright")
async def use_pw(
    service: PlaywrightService = Depends(get_playwright_service),
):
    return [tool.name for tool in service.get_tools()]
