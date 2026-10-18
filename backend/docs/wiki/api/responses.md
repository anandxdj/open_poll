---
summary: Response submission and summary API contracts.
status: active
last_updated: 2026-10-19
---

# Responses API

Base path: `/api/responses`

- `POST /` submit poll responses
- `GET /poll/:pollId/summary` fetch aggregate analytics summary (public)
- `GET /poll/:pollId/list` individual responses with voter identities: authenticated, runs
  `workspaceContext()`, needs `session:read` on the poll (`modules/workspaces.md`)

Submission payload shape:
- `pollId: string`
- `deviceId: string` (frontend UUID used for 24-hour anti-spam guard)
- `respondentId?: string`
- `answers: [{ questionId: string, selectedOptionIndex: number }]`
