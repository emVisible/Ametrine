#!/bin/bash
source ./.venv/activate
uvicorn main:app --reload --timeout-graceful-shutdown 10 --port 3000