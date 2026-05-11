---
summary: Domain-driven backend module boundaries and request flow.
status: active
last_updated: 2026-05-11
---

# Backend Architecture

The backend follows a modular domain-first structure.

- `common/` owns shared config, middleware, response/error utilities, and realtime contracts.
- `modules/polls` owns poll lifecycle and persistence.
- `modules/responses` owns voting validation, storage, and analytics event publishing.
- `modules/ai` owns AI generation workflows and persistence handoff to polls service.

HTTP flow: route -> validate(Zod) -> controller -> service -> model.  
Error flow: service/controller throws `ApiError` -> global `errorHandler`.  
Realtime flow: response accepted -> Redis publish -> Redis subscriber -> Socket room emit.
