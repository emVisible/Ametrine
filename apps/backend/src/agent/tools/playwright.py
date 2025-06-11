from functools import lru_cache

from langchain_community.agent_toolkits import PlayWrightBrowserToolkit
from playwright.async_api import async_playwright


class PlaywrightService:
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.toolkit = None

    async def init(self):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=True)
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
