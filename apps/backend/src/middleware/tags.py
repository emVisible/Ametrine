from enum import Enum


class ControllerTag(Enum):
    dev = "DEV"
    chat = "Chat"
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
    vector = "[Vector]"
    relation = "[Relation]"
    preprocess = "[Preprocess]"
    agent = "[Agent]"
    performance = "[Performance]"
    network = "[Network]"
