---
summary: Poll HTTP endpoints and request/response contracts.
status: active
last_updated: 2026-05-11
---

# Polls API

Base path: `/api/polls`

- `POST /` create poll
- `GET /` list the authenticated caller's polls
- `GET /:id` fetch single poll
- `PATCH /:pollId` update poll
- `POST /:id/close` close poll

All write endpoints use Zod schemas and standardized `ApiResponse`.

A published assessment (`pollType: 'TRIAL'`) must be gradeable: `POST /` rejects it
per field via `createPollRequestSchema`, and `PATCH /:pollId` re-checks against the
stored poll after fetching it. Rules in `modules/polls.md` → "Gradeability rule".
