from pydantic import BaseModel


class SpeechRequest(BaseModel):
    input: str
    voice: str = "zf_xiaoyi"
    response_format: str = "mp3"
    speed: float = 1.0
