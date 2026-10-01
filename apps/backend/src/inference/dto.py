"""推理管理面的请求体。

刻意**不做白名单校验**参数（引擎名、量化格式、size 等）：那些是 xinference 自己的目录，
复制一份校验就是复制一份会过期的知识。我们只校验两件事：
形状（必须是对象、字段类型对）和 uid 规则（下面那条，因为我们必须先知道 uid 才能去轮 progress）。
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field, field_validator

# 与服务器同一条规则（`core/autostart.py:is_valid_model_uid` + normalize 的报错文案）：
# 最长 100，且不能以保留后缀 `-rep<number>` 结尾 —— 副本 uid 是服务器自己拼的，
# 我们占用它会让「查这个 uid 的实例」撞到不该撞的东西上。
_UID_RESERVED_SUFFIX = re.compile(r"-rep\d+$")
UID_MAX_LEN = 100

MODEL_TYPES = ("LLM", "embedding", "rerank", "image", "audio", "video")


class LaunchBody(BaseModel):
    model_name: str
    model_type: str = "LLM"
    model_uid: Optional[str] = None
    model_engine: Optional[str] = None
    size_in_billions: Optional[Any] = None
    model_format: Optional[str] = None
    quantization: Optional[str] = None
    max_model_len: Optional[int] = Field(default=None, ge=1)
    # 0 或负数会被服务器当成合法值往下传（实测 replica=0 曾被受理），
    # 所以我们这边先拒：副本数小于 1 没有任何意义，让它进去只是把错误推到远端。
    replica: Optional[int] = Field(default=None, ge=1)
    n_gpu: Optional[str] = None
    # 其余参数原样转发（peft、chat_wrapper、cpu_can_run…）。
    # 逐个字段化的话，每支持一个新参数都要改我们这边 —— 那正是「承诺不超过实现」的反面。
    extra: Optional[Dict[str, Any]] = None
    # 加载的同时登记为自启动：省掉「先加载、再去开 autostart」两次点击
    autostart: bool = False

    @field_validator("model_name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("model_name 不能为空")
        return v

    @field_validator("model_type")
    @classmethod
    def _type_known(cls, v: str) -> str:
        if v not in MODEL_TYPES:
            raise ValueError(
                f"model_type 只接受 {'/'.join(MODEL_TYPES)} 之一，收到 {v!r}"
            )
        return v

    @field_validator("model_uid")
    @classmethod
    def _uid_rules(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        v = v.strip()
        if len(v) > UID_MAX_LEN:
            raise ValueError(f"model_uid 最长 {UID_MAX_LEN} 字符")
        if _UID_RESERVED_SUFFIX.search(v):
            raise ValueError("model_uid 不能以保留后缀 -rep<number> 结尾")
        return v

    def to_launch_payload(self) -> Dict[str, Any]:
        """拼出 xinference `POST /v1/models` 的 body（None 一律不送）。"""
        payload: Dict[str, Any] = {
            "model_name": self.model_name,
            "model_type": self.model_type,
            "model_uid": self.model_uid or self.model_name,
        }
        for key in (
            "model_engine",
            "size_in_billions",
            "model_format",
            "quantization",
            "max_model_len",
            "replica",
            "n_gpu",
        ):
            value = getattr(self, key)
            if value is not None:
                payload[key] = value
        if self.extra:
            payload.update(self.extra)
        # 不要把 wait_ready 放进来：它是 **query 参数**（`restful_api.py:1474`
        # `wait_ready: bool = Query(True)`），塞进 body 会随 **kwargs 进 actor 方法，
        # 得到 `HTTP 500: <ActorRefMethod ...> got multiple values for keyword argument`。
        # 不等的策略在 service.start_launch 里用 ?wait_ready=false 实现。
        return payload

    def autostart_entry(self) -> Dict[str, Any]:
        return {"enabled": True, "launch": self.to_launch_payload()}


class BindingBody(BaseModel):
    model_uid: str
    model_name: Optional[str] = None

    @field_validator("model_uid")
    @classmethod
    def _uid(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("model_uid 不能为空")
        if len(v) > UID_MAX_LEN:
            raise ValueError(f"model_uid 最长 {UID_MAX_LEN} 字符")
        return v


class AutostartBody(BaseModel):
    enabled: bool = True
    priority: Optional[int] = None
    max_retries: Optional[int] = Field(default=None, ge=1)
    retry_interval_seconds: Optional[int] = Field(default=None, ge=1)
