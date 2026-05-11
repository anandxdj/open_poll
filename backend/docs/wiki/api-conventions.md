---
summary: API conventions for controllers, services, validation, and errors.
status: active
last_updated: 2026-05-11
---

# API Conventions

- Controllers only handle `req/res` concerns and delegate business logic to services.
- Services own database access and domain rules.
- Request body validation must use Zod schemas in module `*.schema.ts` files.
- Routes must wrap validated endpoints with `validate(schema)`.
- Success responses must use `ApiResponse`.
- Failures should use `ApiError` and bubble to global `errorHandler`.
- Auth is deferred; mocked creator IDs remain valid until auth module lands.
