from enum import Enum


class ControllerTag(Enum):
    dev = "DEV"
    chat = "Chat"
    audio = "Audio"
    llm = "LLM"
    user = "User"
    auth = "Auth"
    vector_db = "Vector Database"
    relation_db = "Relation Database"
    init = "Initialization"
    agent = "Agent"


class LoggerTag(Enum):
    project = "[Project]"
    auth = "[Auth]"
    model = "[Model]"
    audio = "[Audio]"
    vector = "[Vector]"
    relation = "[Relation]"
    preprocess = "[Preprocess]"
    agent = "[Agent]"
    performance = "[Performance]"
    network = "[Network]"
