from src.config import settings
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper

class WikiService:
    def __init__(self):
        wrapper_kwargs = {}
        if settings.https_proxy:
            wrapper_kwargs["proxy"] = settings.https_proxy
        elif settings.http_proxy:
            wrapper_kwargs["proxy"] = settings.http_proxy
        self.service = WikipediaQueryRun(
            api_wrapper=WikipediaAPIWrapper(**wrapper_kwargs)
        )

    def run(self, query: str):
        return self.service.run(query)


def get_wiki_service():
    return WikiService()