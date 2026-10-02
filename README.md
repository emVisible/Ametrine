<div align="center">

<img src="apps/frontend/public/favicon.png" alt="Ametrine" width="96" height="96" />

# Ametrine

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12-blue)
![Runtime](https://img.shields.io/badge/runtime-self--hosted-blue)

**English** · [简体中文](README_zh.md)

Ametrine is a local-first knowledge base built around RAG.

It supports semantic chunking of documents, vectorization into Milvus, and answers with sources, chunk IDs, and relevance scores; it also supports multi-tenancy, knowledge-base-level permissions, token quotas, and chunk-level governance.

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
#    at minimum change SECRET_KEY (the template shows the command), the password inside
#    POSTGRE_ADDR, and DOC_ADDR — the backend refuses to start otherwise, or starts with a
#    document directory it cannot write to

# 3. application environment
cd apps/backend && uv sync && cd ../..

# 4. schema — this step is **not** `alembic upgrade head`
#    The earliest migration only contains ALTERs, so it needs a `user` table that nothing creates;
#    and the lifespan's create_all neither writes `alembic_version` nor seeds the `role` table,
#    which is what `user.role_id` has a foreign key to — with an empty `role` table the very first
#    registration fails with a foreign key violation that never mentions roles.
#    init_db.py does all three, idempotently: create tables from the models, seed
#    user/manager/admin, stamp the migration head.
apps/backend/.venv/bin/python scripts/init_db.py --create-database

# 5. the first admin — self-service registration cannot produce one (the service pins role_id=1),
#    and without it /admin/* and the Inference console stay 403 forever
apps/backend/.venv/bin/python scripts/create_admin.py --name <your-login>

# 6. preflight (read-only, changes nothing): per-extension parse capability, external services,
#    pyproject vs uv.lock drift, and whether bound models really answer
apps/backend/.venv/bin/python scripts/doctor.py
apps/backend/.venv/bin/python scripts/doctor.py --live   # also calls embedding / rerank / generate

# 7. inference environment (skippable: the app boots without any model loaded)
bash scripts/setup_inference_env.sh

# 8. frontend, Xinference and backend in one tmux session — this starts services only
./dev.sh

# 9. which models actually run is a setting inside the app now:
#    admin console → Inference (http://localhost:8000/admin/inference)
#    Loading, unloading, re-binding and "start with the server" all happen there.
#    `scripts/load_models.sh` remains the one-off bootstrap for the three model ids in .env.
```

Open <http://localhost:8000>. Interactive API documentation is at
<http://localhost:3000/docs>.

For real deployment do not serve the vite dev server: `cd apps/frontend && pnpm build`, then point
a web server at `apps/frontend/dist/` — `apps/frontend/deploy/nginx.conf` in this repo is exactly
that config (`/api` proxied to the backend, SPA routes falling back to `index.html`).

## Configuration

`apps/backend/.env` is not tracked; `.env.example` documents every key. The values that matter
most:

| Key | Meaning |
| --- | --- |
| `SECRET_KEY` | JWT signing secret. Generate a fresh one per deployment — tokens are unverifiable if it is shared or committed |
| `POSTGRE_ADDR` | Async SQLAlchemy DSN (`postgresql+asyncpg://user:pass@host:5432/ametrine`) |
| `MILVUS_HOST` / `MILVUS_PORT` / `MILVUS_METRIC_TYPE` | Vector store target. With `L2`, smaller distance means better match |
| `XINFERENCE_MAIN_ADDR` | Xinference target |
| `XINFERENCE_ADMIN_USER` / `XINFERENCE_ADMIN_PASSWORD` | Credential the backend signs its Xinference JWT with (`src/inference/auth.py`, re-signed on 401). Xinference 3.x has auth **on by default**, so without these the app cannot infer at all — and `/health` won't show it, it only probes Postgres/Redis/Milvus |
| `XINFERENCE_API_KEY` | Optional, legacy shape. An API key can only list/query models — it **cannot launch** (measured 403), and the JWT above covers both inference and management, so this key is no longer required |
| `XINFERENCE_{LLM,EMBEDDING,RERANK}_MODEL_ID` | **Deprecated seed (one more version).** Which model answers is stored in the `inference_role_binding` table and changed in the admin console; these three are only read to seed that table when it is still empty |
| `K` / `P` / `MIN_RELEVANCE_SCORE` | Candidate count, final context size, rerank relevance floor. The floor is measured, not guessed: gold chunks on this corpus have a median rerank score of 0.0397, so `0.3` deleted 71% of the gold evidence and left 65% of queries with no reference at all (see `rag-bench/README.md` §2.4) |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` / `SEMANTIC_SPLITTER` | Ingestion splitting. `CHUNK_SIZE` is a **hard cap on both paths**; `SEMANTIC_SPLITTER=true` only changes *where an oversized paragraph gets cut* — a structurally normal document issues zero embedding requests just to be chunked. Existing documents keep the profile they were indexed with |
| `EMBEDDING_DIMENSION` | Must match the embedding model, and changing it means re-indexing |
| `DOC_ADDR` | Where uploaded originals land. A relative value resolves against the **repo root** (not the cwd); it is created and write-checked at startup, and the app refuses to boot otherwise |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` / `REDIS_PASSWORD` | Session citations, the per-user concurrency gate and login-failure counters all live in Redis. These keys are new — the parameters used to be hardcoded in `src/client.py`, so changing port or adding a password meant editing source. The defaults are exactly the old hardcoded values |

## Checks

```bash
cd apps/frontend && pnpm check     # tsc -b + eslint --max-warnings=0 + 131 unit tests
# Migrations now read POSTGRE_ADDR from .env (the hardcoded url in alembic.ini is emptied):
cd apps/backend && .venv/bin/alembic current && .venv/bin/alembic upgrade head
# On an empty database do NOT run upgrade head — use scripts/init_db.py (Quick start step 4)

# Deployment preflight (read-only): parse capability, services, dependency drift, model liveness
apps/backend/.venv/bin/python scripts/doctor.py --live

# Inference wiring, in-process (no server needed beyond the DB):
apps/backend/.venv/bin/python scripts/selfcheck_inference.py
# Knowledge-base side, also in-process — all stubs, touches no real data:
apps/backend/.venv/bin/python scripts/selfcheck_knowledge_base.py
# The chunker: `chunk_size` is a hard cap, and a structurally normal document
# issues zero embedding requests just to be split:
apps/backend/.venv/bin/python scripts/selfcheck_splitter.py
# Upload cancellation cleanup (a fake upload raises CancelledError on the second read()):
apps/backend/.venv/bin/python scripts/selfcheck_upload_cancel.py
# The admin console against a running backend + Xinference — creates a throwaway admin
# account, writes a binding, restores it, and deletes the account in a `finally`:
apps/backend/.venv/bin/python scripts/gate_inference_http.py
```

`npm run check` is the gate, not `npx tsc --noEmit`: the frontend `tsconfig.json` is
solution-style, so `--noEmit` at that root checks zero files and exits 0. Every message key is a
compile-checked path (`MsgKey`), so a missing translation fails the build instead of printing the
raw key.

## Security model

- Requests are authenticated with a signed JWT; roles are `user`, `manager`, `admin`.
- Every knowledge-base read and write is authorised against the caller's grants — the checks run
  before the vector store or the models are touched, so an unauthorised request gets `403`, not a
  stack trace from an unrelated dependency.
- Cross-tenant access is denied per route, not per UI: listing documents, opening a document, or
  reading its chunks all resolve the owning database first.
- Admin-owned fields (roles, token limits) cannot be changed by self-service.
- Token usage is computed from persisted assistant messages, so a limit cannot be dodged by
  clearing browser storage. It is enforced on every generation route, not just some of them.
- Failed logins return one identical response for "no such user" and "wrong password", counted per
  IP and account, so the endpoint is not an account-discovery oracle.
- Uploads are size-capped and limited to the extensions the parser actually supports. Parse or index
  failures report an exception *type* to the client and keep the detail in the server log.

## Deployment boundary

`apps/database/docker-compose.yml` describes a **single-machine development topology**, and it is not
safe by default beyond that: Postgres, Redis and Milvus publish their ports to all interfaces, Redis
and Milvus run without authentication, and the sample credentials (`preview`, `minioadmin`) are the
ones in the file. Anyone who can reach port `19530` reads and deletes every tenant's vectors without
passing this API at all — the role and grant model above only governs traffic that comes through it.

Before this topology serves a second machine, or anything reachable from a network:

1. bind every published port to loopback (`127.0.0.1:5432:5432`), and don't expose Milvus's `9091`
   management port at all;
2. turn on authentication for Redis (`requirepass`), Milvus (`authorizationEnabled`) and MinIO
   (non-default credentials), and set a Postgres password worth having;
3. keep `SECRET_KEY` strong — the backend refuses to start on a short, placeholder or low-entropy one;
4. set `CORS_ORIGINS` to the exact browser origins that should reach the API. Wildcards are not
   accepted on purpose: the API issues bearer tokens and the frontend keeps them in browser storage;
5. Redis is configured from `.env` now (`REDIS_HOST/PORT/DB/PASSWORD`) — set `REDIS_PASSWORD` once you
   add `requirepass`, and separate co-located deployments by `REDIS_DB`.

Upgrading the vector store is not optional either: Milvus below `2.5.27` answers unauthenticated
requests on its management port by design, so pin the image version rather than trusting the local
firewall.

None of the above is advice you have to remember: `scripts/doctor.py` checks it read-only. It reports
per-extension parse capability (a missing `unstructured[pdf]` or `pandoc` means that upload returns
501 — knowing that *before* a user hits it is the whole point), whether `pyproject.toml` and
`uv.lock` agree, whether Postgres/Redis/Milvus/Xinference answer, and whether the bound models are
actually reachable. Run `--live` once after deploying: during this round a CUDA sticky device-side
assert left 48 of 57 requests returning empty answers while both `/v1/models` and
`/api/inference/overview` reported the model as running — **a readable registry is not a usable
model**, and only a generation probe can tell them apart.

The same judgement now lives inside the app: the Inference console has a **liveness probe**
panel (`POST /api/inference/liveness`) that really calls each bound role once and says what
"usable" meant for that role — non-empty completion, embedding dimension matching
`EMBEDDING_DIMENSION`, rerank returning results. It is deliberately not part of `/health`:
that endpoint is polled every few seconds by the launcher, and a readiness probe must not
become a load source.

Release notes live in [`CHANGELOG.md`](CHANGELOG.md); the version number has a single source in
`apps/backend/src/version.py`, and `scripts/doctor.py` checks that the four places that carry it
agree with the newest tag.

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

*To the youth we are letting go of.* 🌙
