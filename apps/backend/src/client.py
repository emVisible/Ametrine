from asyncio import Lock

import redis
from langchain_community.embeddings import XinferenceEmbeddings
from xinference.client import RESTfulClient

from .config import (
    xinference_addr,
    xinference_embedding_model_id,
    xinference_llm_model_id,
    xinference_rerank_model_id,
)

model_lock = Lock()
client = RESTfulClient(base_url=xinference_addr)
llm_model = client.get_model(model_uid=xinference_llm_model_id)
rerank_model = client.get_model(model_uid=xinference_rerank_model_id)
embedding_function = XinferenceEmbeddings(
    server_url=xinference_addr, model_uid=xinference_embedding_model_id
)
redis_client = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)