---
summary: Poll HTTP endpoints and request/response contracts.
status: active
last_updated: 2026-10-19
---

# Polls API

Base path: `/api/polls`

- `POST /` create poll in the current workspace (`deck:create`)
- `GET /` list the current workspace's polls (`deck:read`)
- `GET /:id` fetch single poll (public when published; drafts need `deck:read`, else 404)
- `PATCH /:pollId` update poll (`deck:edit`)
- `POST /:id/close` close poll (`deck:host`)
- `POST /:id/publish-results` publish results (`session:share`)
- `DELETE /:id` delete poll (`deck:delete`)

Authenticated routes act in the workspace named by `X-Workspace-Id` (else the caller's
default); a workspace the caller is not an active member of is `403 WORKSPACE_FORBIDDEN`,
a denied action `403 FORBIDDEN`. Details: `modules/workspaces.md`.

All write endpoints use Zod schemas and standardized `ApiResponse`.

A published assessment (`pollType: 'TRIAL'`) must be gradeable: `POST /` rejects it
per field via `createPollRequestSchema`, and `PATCH /:pollId` re-checks against the
stored poll after fetching it. Rules in `modules/polls.md` → "Gradeability rule".
