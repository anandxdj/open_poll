---
summary: Local backend setup with Bun, MongoDB, Redis, and Gemini env.
status: active
last_updated: 2026-05-11
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
4. `bun run dev`

## Health
- `GET /health` for process health
- `GET /ready` for Mongo + Redis readiness
