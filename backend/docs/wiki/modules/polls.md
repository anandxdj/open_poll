---
summary: Poll module responsibilities, lifecycle states, and key rules.
status: active
last_updated: 2026-05-11
---

# Polls Module

`modules/polls` manages poll definition and lifecycle.

## Lifecycle State
- `isPublished`: controls whether respondents can submit.
- `isClosed`: terminal state set by close endpoint.
- `expiresAt`: time-based closure guard.

## Guarantees
- Questions are single-option multiple-choice only.
- Every question has at least 2 options.
- Poll must contain at least one question.
- Closed polls cannot be updated.
