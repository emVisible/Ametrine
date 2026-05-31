from langchain_community.tools.shell import ShellTool
from src.config import agent_shell_enabled


DENIED_FRAGMENTS = (
    "rm ",
    "rm -",
    "del ",
    "rmdir",
    "format ",
    "shutdown",
    "reboot",
    "mkfs",
    "dd ",
    ":(){",
    "chmod 777",
    "chown ",
)


class ShellService:
    def __init__(self):
        self.service = ShellTool()

    def run(self, command: str):
        if not agent_shell_enabled:
            return "Shell tool is disabled. Enable AGENT_SHELL_ENABLED only for trusted local sessions."
        normalized = f" {command.strip().lower()} "
        if any(fragment in normalized for fragment in DENIED_FRAGMENTS):
            return "Command blocked by Ametrine shell safety policy."
        return self.service.run(command)


def get_shell_service():
    return ShellService()
