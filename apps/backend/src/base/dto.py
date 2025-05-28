from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
    email: EmailStr = Field(...)
    password: str = Field(..., min_length=4, max_length=256)
