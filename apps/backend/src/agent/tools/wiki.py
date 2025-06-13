from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper


class WikiService:
    def __init__(self, service: WikipediaQueryRun):
        self.service = service

    def run(self, query: str):
        return self.service.run(query)


def get_wiki_service():
    return WikiService(service=WikipediaQueryRun(api_wrapper=WikipediaAPIWrapper()))
