from pydantic import BaseModel

class AddMessageDTO(BaseModel):
    role: str
    content: str