#!/bin/bash
source "./env_rag/bin/activate"
XINFERENCE_MODEL_SRC=modelscope xinference-local --host 0.0.0.0 --port 9997