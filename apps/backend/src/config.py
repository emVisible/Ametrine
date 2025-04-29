from dotenv import load_dotenv
from os import getenv

load_dotenv()

# 获取基础配置
algorithm = getenv("ALGORITHM")
secret_key = getenv("SECRET_KEY", "")
access_token_expire_minutes = int(getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

# 检索参数
k = int(getenv("K", "5"))
chunk_size = int(getenv("CHUNK_SIZE", "512"))
chunk_overlap = int(getenv("CHUNK_OVERLAP", "50"))
max_model_len = int(getenv("MAX_MODEL_LEN", "30000"))
min_relevance_score = int(getenv("MIN_RELEVANCE_SCORE", "8"))

# 数据库和文档地址
db_addr = getenv("DB_ADDR")
doc_addr = getenv("DOC_ADDR")

# XInference 相关配置
xinference_addr = getenv("XINFERENCE_ADDR", "http://127.0.0.1:9997")
xinference_llm_model_id = getenv("XINFERENCE_LLM_MODEL_ID")
xinference_rerank_model_id = getenv("XINFERENCE_RERANK_MODEL_ID", "bge-reranker-v2-m3")
xinference_embedding_model_id = getenv(
    "XINFERENCE_EMBEDDING_MODEL_ID", "bge-large-zh-v1.5"
)
