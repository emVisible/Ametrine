from dotenv import load_dotenv
import os

# 加载 .env 配置
load_dotenv()

# 获取基础配置
algorithm = os.getenv("ALGORITHM")
secret_key = os.getenv("SECRET_KEY", "")
access_token_expire_minutes = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

# 检索参数
k = int(os.getenv("K", "5"))
chunk_size = int(os.getenv("CHUNK_SIZE", "512"))
chunk_overlap = int(os.getenv("CHUNK_OVERLAP", "50"))
max_model_len = int(os.getenv("MAX_MODEL_LEN", "30000"))
min_relevance_score = int(os.getenv("MIN_RELEVANCE_SCORE", "8"))

# 数据库和文档地址
db_addr = os.getenv("DB_ADDR")
doc_addr = os.getenv("DOC_ADDR")

# XInference 相关配置
xinference_addr = os.getenv("XINFERENCE_ADDR", "http://127.0.0.1:9997")
xinference_llm_model_id = os.getenv("XINFERENCE_LLM_MODEL_ID")
xinference_rerank_model_id = os.getenv("XINFERENCE_RERANK_MODEL_ID", "bge-reranker-v2-m3")
xinference_embedding_model_id = os.getenv("XINFERENCE_EMBEDDING_MODEL_ID", "bge-large-zh-v1.5")

# Chroma 地址
chroma_addr = os.getenv("CHROMA_ADDR", "http://127.0.0.1:8080")

# ✅ 可选：检查关键配置
required_vars = {
    "ALGORITHM": algorithm,
    "SECRET_KEY": secret_key,
    "DB_ADDR": db_addr,
    "DOC_ADDR": doc_addr,
    "XINFERENCE_LLM_MODEL_ID": xinference_llm_model_id,
}

missing = [k for k, v in required_vars.items() if not v]
if missing:
    raise EnvironmentError(f"❌ 缺少关键环境变量：{', '.join(missing)}")