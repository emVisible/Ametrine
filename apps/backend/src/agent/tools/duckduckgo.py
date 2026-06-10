# src/agent/tools/duckduckgo.py
from src.config import settings
from langchain_community.tools import DuckDuckGoSearchResults

class DuckDuckGoService:
    def __init__(self):
        kwargs = {"output_format": "list"}
        proxy = settings.https_proxy or settings.http_proxy
        if proxy:
            kwargs["proxy"] = proxy
        self.service = DuckDuckGoSearchResults(**kwargs)

    def run(self, query: str):
        return self.service.invoke(query)


def get_duckduckgo_service():
    return DuckDuckGoService()