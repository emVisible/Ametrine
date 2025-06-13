from langchain_community.tools import DuckDuckGoSearchResults


class DuckDuckGoService:
    def __init__(self, service: DuckDuckGoSearchResults):
        self.service = service

    def run(self, query: str):
        return self.service.invoke(query)


def get_duckduckgo_service():
    return DuckDuckGoService(service=DuckDuckGoSearchResults(output_format="list"))
