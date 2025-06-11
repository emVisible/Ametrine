from fastapi import Depends
from langchain import hub
from langchain.agents import AgentExecutor, create_structured_chat_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import Tool
from src.client import get_llm_model_for_agent

from .tools.playwright import PlaywrightService, get_playwright_service
from .tools.shell import ShellService, get_shell_service
from .tools.spider import SpiderService, get_spider_service


class AgentService:
    def __init__(
        self,
        llm: BaseChatModel,
        spider_service: SpiderService,
        shell_service: ShellService,
        playwrigt_service: PlaywrightService,
    ):
        self.llm = llm
        self.spider_service = spider_service
        self.shell_service = shell_service
        self.playwrigt_service = playwrigt_service
        self._agent_executor = None

    def _get_prompt(self):
        return hub.pull("hwchase17/structured-chat-agent")

    def _get_tools(self):
        return self.playwrigt_service.get_tools() + [
            # Tool(
            #     name="Spider",
            #     func=self.spider_service.search,
            #     description="For answering questions by searching from the web to get the latest information when necessary.",
            #     coroutine=self.spider_service.search,
            # ),
            # Tool(
            #     name="Shell",
            #     func=self.shell_service.run,
            #     description="Executing shell commands if necessary, except dangerous command.",
            # ),
        ]

    def get_agent_executor(self) -> AgentExecutor:
        if self._agent_executor is None:
            prompt = self._get_prompt()
            tools = self._get_tools()
            agent = create_structured_chat_agent(
                llm=self.llm, tools=tools, prompt=prompt
            )
            self._agent_executor = AgentExecutor(
                agent=agent, tools=tools, verbose=True, handle_parsing_errors=True
            )
        return self._agent_executor


def get_agent_service(
    llm_service: BaseChatModel = Depends(get_llm_model_for_agent),
    spider_service: SpiderService = Depends(get_spider_service),
    shell_service: ShellService = Depends(get_shell_service),
    playwrigt_service: PlaywrightService = Depends(get_playwright_service),
):
    return AgentService(
        llm=llm_service,
        spider_service=spider_service,
        shell_service=shell_service,
        playwrigt_service=playwrigt_service,
    )
