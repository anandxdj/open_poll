---
summary: Poll HTTP endpoints and request/response contracts.
status: active
last_updated: 2026-05-11
---

# Polls API

Base path: `/api/polls`

- `POST /` create poll
- `GET /` list polls by `creatorId` query (defaults to mock creator)
- `GET /:pollId` fetch single poll
- `PATCH /:pollId` update poll
- `POST /:pollId/close` close poll

All write endpoints use Zod schemas and standardized `ApiResponse`.
