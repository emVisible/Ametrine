from enum import Enum


class ControllerTag(Enum):
    dev = "DEV"
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
    vector = "[Vector]"
    model = "[Model]"
    relation = "[Relation]"
    preprocess = "[Preprocess]"
    agent = "[Agent]"
    performance = "[Performance]"
