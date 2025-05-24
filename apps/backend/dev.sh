#!/bin/bash
conda activate ametrine
uvicorn main:app --reload --port 3000