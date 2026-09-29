<div align="center">

<img src="apps/frontend/public/favicon.png" alt="Ametrine" width="96" height="96" />

# Ametrine

> A self-hosted Retrieval-Augmented-Generation workspace: your documents, your models, your database — no vendor in the loop.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12-blue)
![Runtime](https://img.shields.io/badge/runtime-self--hosted-blue)

**English** · [简体中文](README_zh.md)

Ametrine is a local-first knowledge base built around RAG. It ingests real documents,
splits them semantically, embeds them into Milvus, and answers questions with the source document,
chunk id and relevance score attached. Multi-tenancy, per-knowledge-base permissions, token quotas,
and chunk-level curation are part of the product, not bolted on.

</div>

---

## Highlights

| Area | What you get |
| --- | --- |
| Retrieval | Dense vector search, optional cross-encoder reranking, per-request `top_k`, relevance threshold, and a **hit-testing panel** that shows exactly what a query recalled before any model is called |
| Curation | Per-chunk **exclude / edit (re-embed) / delete**, whole-document toggle, live counts — fix a bad split without re-uploading the file |
| Provenance | Citations are stored with the message (`message.meta`), so an answer stays verifiable after a refresh, a cache clear, or a different device |
| Multi-tenancy | Each tenant owns one knowledge base (one Milvus database); members get read / write / manage grants per base |
| Quota | Daily and monthly token budgets derived from stored messages, enforced at the model boundary with `429`; `0` means unlimited |
| Conversation | SSE streaming that survives switching sessions, lazy session creation, bilingual UI (zh / en), light and dark themes, browser-based voice input |

## Architecture

```
apps/
├── frontend/   React 19 · Vite · Tailwind v4 · Zustand · TanStack Query · React Router 7
├── backend/    FastAPI · SQLAlchemy 2 (async) · LangChain loaders · pymilvus
├── inference/  Isolated Xinference environment (no vLLM, therefore no pinned torch)
└── database/   Docker Compose: PostgreSQL 16 + pgvector, Redis 7, Milvus 2.5, etcd, MinIO
```

| Service | Port | Notes |
| --- | --- | --- |
| Frontend | `8000` | Vite dev server, proxies `/api` to the backend |
| Backend | `3000` | OpenAPI at `/docs`; liveness probe is `GET /health` (root, **not** `/api/health`) |
| Xinference | `9997` | LLM · embedding · rerank models |
| PostgreSQL | `5432` | Relations, documents, chunks, messages, grants |
| Milvus | `19530` | Vectors; one Milvus database per tenant |
| Milvus UI | `9091` | Optional inspection |
| Redis | `6379` | Short-lived citation cache between stream and history |

PostgreSQL holds the text and the truth; Milvus holds the vectors. Retrieval returns
`(doc_id, chunk_id)` pairs and the body is hydrated from PostgreSQL, which is why excluding a
chunk needs no vector-store migration.

## Requirements

- Ubuntu 20.04+ (development happens inside WSL2)
- Python 3.11 – 3.12 and [uv](https://docs.astral.sh/uv/)
- Node.js ≥ 20 (the dev script pins 25 via `fnm`) with `pnpm`
- Docker Compose for the data tier
- A GPU is optional. A ~10 GB card runs a development set: one small instruct LLM, `bge-m3` for
  embeddings, `bge-reranker-base` for reranking. Nothing is downloaded unless you ask for it.

## Quick start

```bash
git clone https://github.com/emVisible/Ametrine.git
cd Ametrine

# 1. data tier — PostgreSQL, Redis, Milvus
docker compose -f apps/database/docker-compose.yml up -d

# 2. configuration — copy the templates and fill them in (never commit the result)
cp apps/backend/.env.example  apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env

# 3. application environment
cd apps/backend && uv sync && uv run alembic upgrade head && cd ../..

# 4. inference environment + models (skippable: the app boots without them)
bash scripts/setup_inference_env.sh
bash scripts/load_models.sh apps/backend

# 5. everything else — frontend, Xinference, backend in one tmux session
./dev.sh
```

Open <http://localhost:8000>. Interactive API documentation is at
<http://localhost:3000/docs>.

## Configuration

`apps/backend/.env` is not tracked; `.env.example` documents every key. The values that matter
most:

| Key | Meaning |
| --- | --- |
| `SECRET_KEY` | JWT signing secret. Generate a fresh one per deployment — tokens are unverifiable if it is shared or committed |
| `POSTGRE_ADDR` | Async SQLAlchemy DSN (`postgresql+asyncpg://user:pass@host:5432/ametrine`) |
| `MILVUS_HOST` / `MILVUS_PORT` / `MILVUS_METRIC_TYPE` | Vector store target. With `L2`, smaller distance means better match |
| `XINFERENCE_MAIN_ADDR` · `XINFERENCE_{LLM,EMBEDDING,RERANK}_MODEL_ID` | Which models to call, by model **uid** |
| `XINFERENCE_API_KEY` | Leave empty for an unauthenticated Xinference; set it once server auth is on |
| `K` / `P` / `MIN_RELEVANCE_SCORE` | Candidate count, final context size, rerank relevance floor |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` / `SEMANTIC_SPLITTER` | Ingestion splitting; existing documents keep the profile they were indexed with |
| `EMBEDDING_DIMENSION` | Must match the embedding model, and changing it means re-indexing |

## Checks

```bash
cd apps/frontend && pnpm check     # typecheck + lint + 57 unit tests
cd apps/backend  && uv run alembic upgrade head
```

## Security model

- Requests are authenticated with a signed JWT; roles are `user`, `manager`, `admin`.
- Every knowledge-base read and write is authorised against the caller's grants — the checks run
  before the vector store or the models are touched, so an unauthorised request gets `403`, not a
  stack trace from an unrelated dependency.
- Cross-tenant access is denied per route, not per UI: listing documents, opening a document, or
  reading its chunks all resolve the owning database first.
- Admin-owned fields (roles, token limits) cannot be changed by self-service.
- Token usage is computed from persisted assistant messages, so a limit cannot be dodged by
  clearing browser storage.

## Known limitations

- Generation is request-scoped on the server. Switching conversations inside the app keeps the
  stream alive; closing the tab does not.
- Retrieval is dense-only. Hybrid BM25 / sparse search with RRF fusion would need new scalar
  fields on existing Milvus collections, i.e. a full re-index.
- Agent and tool-call output has a table and a streaming event reserved for it, but no agent
  runtime ships on this branch.
- Voice input uses the browser's Web Speech API, so it depends on browser support and a network
  round-trip to the browser vendor's speech service.

## Contributing

Issues and pull requests are welcome. If you find a correctness bug — especially one that makes a
wrong answer look right — open an issue first; those get priority.

## License

Released under the [Apache License 2.0](LICENSE). The file is the canonical text with only the
copyright line filled in: `Copyright 2026 emVisible`.

## Acknowledgements

Built with FastAPI, LangChain, Milvus, Xinference, PostgreSQL and React.

*To the youth we are letting go of.* 🌙
