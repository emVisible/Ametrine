from fastapi import Depends
from langchain_community.tools.shell import ShellTool


class ShellService:
    def __init__(self):
        self.service = ShellTool()

    def run(self, command: str):
        return self.service.run(command)


def get_shell_service() -> ShellService:
    return ShellService()
