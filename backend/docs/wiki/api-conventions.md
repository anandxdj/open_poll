---
summary: API conventions for controllers, services, validation, and errors.
status: active
last_updated: 2026-10-19
---

# API Conventions

- Controllers only handle `req/res` concerns and delegate business logic to services.
- Services own database access and domain rules.
- Request body validation must use Zod schemas in module `*.schema.ts` files.
- Routes must wrap validated endpoints with `validate(schema)`.
- Success responses must use `ApiResponse`.
- Failures should use `ApiError` and bubble to global `errorHandler`.
- Errors a client must tell apart carry a stable code: `new ApiError(status, message, code, details?)`
  → `{ success: false, message, code, details }` (e.g. `FEATURE_NOT_IN_PLAN`, `PLAN_LIMIT_REACHED`,
  `STORAGE_DISABLED`, `WORKSPACE_FORBIDDEN`, `FORBIDDEN`). Codes are UPPER_SNAKE and never change
  meaning; `message` is for humans and may change. `details` must be JSON-safe and never leak data
  the caller may not see.
- Workspace-scoped routes: `authenticate()` → `workspaceContext()` → `assertCan(req, action, resource)`
  (see `platform/tenancy.md`).
- Auth is deferred; mocked creator IDs remain valid until auth module lands.
