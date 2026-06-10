from functools import lru_cache
from langchain_community.agent_toolkits import PlayWrightBrowserToolkit
from playwright.async_api import async_playwright
from src.config import settings


class PlaywrightService:
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.toolkit = None

    async def init(self):
        self.playwright = await async_playwright().start()

        launch_args = {"headless": True}
        proxy = settings.https_proxy or settings.http_proxy
        if proxy:
            launch_args["proxy"] = {"server": proxy}
        self.browser = await self.playwright.chromium.launch(**launch_args)
        self.toolkit = PlayWrightBrowserToolkit.from_browser(async_browser=self.browser)

    def get_tools(self):
        return self.toolkit.get_tools()

    async def shutdown(self):
        if self.browser:
            await self.browser.close()
            self.browser = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None


@lru_cache()
def get_playwright_service():
    return PlaywrightService()
