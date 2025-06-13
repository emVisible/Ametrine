from fastapi import Depends
from langchain import hub
from langchain.agents import AgentExecutor, create_structured_chat_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.tools import Tool
from src.client import get_llm_model_for_agent

from .tools.duckduckgo import DuckDuckGoService, get_duckduckgo_service
from .tools.playwright import PlaywrightService, get_playwright_service
from .tools.shell import ShellService, get_shell_service
from .tools.wiki import WikiService, get_wiki_service


class AgentService:
    def __init__(
        self,
        llm: BaseChatModel,
        shell_service: ShellService,
        wiki_service: WikiService,
        playwrigt_service: PlaywrightService,
        duckduckgo_service: DuckDuckGoService,
    ):
        self.llm = llm
        self.shell_service = shell_service
        self.wiki_service = wiki_service
        self.playwrigt_service = playwrigt_service
        self.duckduckgo_service = duckduckgo_service
        self._agent_executor = None

    def _get_prompt(self):
        return hub.pull("hwchase17/structured-chat-agent")

    def _get_tools(self):
        return [
            Tool(
                name="Wikipedia",
                func=self.wiki_service.run,
                description="For answering questions by searching Wikipedia. ",
            ),
            Tool(
                name="DuckDuckGo",
                func=self.duckduckgo_service.run,
                description="For answering questions by searching DuckDuckGo.",
            ),
            Tool(
                name="Shell",
                func=self.shell_service.run,
                description="Executing shell commands if necessary, note that except all dangerous command.",
            ),
        ] + self.playwrigt_service.get_tools()

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
    shell_service: ShellService = Depends(get_shell_service),
    wiki_service: WikiService = Depends(get_wiki_service),
    playwrigt_service: PlaywrightService = Depends(get_playwright_service),
    duckduckgo_service: PlaywrightService = Depends(get_duckduckgo_service),
):
    return AgentService(
        llm=llm_service,
        shell_service=shell_service,
        wiki_service=wiki_service,
        playwrigt_service=playwrigt_service,
        duckduckgo_service=duckduckgo_service,
    )
