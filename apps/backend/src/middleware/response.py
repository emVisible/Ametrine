from typing import Any, Generic, Optional, TypeVar

from fastapi.responses import JSONResponse
from pydantic import BaseModel

T = TypeVar("T")


class BaseResponse(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T]


class IResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        if not isinstance(content, BaseResponse):
            content = BaseResponse(data=content)
        return super().render(content.model_dump())
