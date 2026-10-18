---
summary: Local backend setup with Bun, MongoDB, Redis, and Gemini env.
status: active
last_updated: 2026-10-19
---

# Local Development Setup

## Prerequisites
- Bun runtime
- Docker Desktop
- Gemini API key

## Steps
1. `bun install`
2. `docker compose up -d`
3. Set `.env`:
   - `MONGO_URI`
   - `REDIS_URL`
   - `GEMINI_API_KEY`
4. `bun run migrate` (creates indexes for the workspace/platform collections; re-run after pulling new migrations)
5. `bun run dev`

Optional features (billing, object storage, SSO, imports, custom domains, metrics) stay off
until their variables are set; see `backend/.env.example` and `GET /api/capabilities`.

## Health
- `GET /health` for process health
- `GET /ready` for Mongo + Redis readiness
