#!/bin/bash
source ./.venv/activate
uvicorn main:app --reload --port 3000