---
summary: Response module validation and analytics event publication behavior.
status: active
last_updated: 2026-05-11
---

# Responses Module

`modules/responses` accepts votes and enforces poll participation rules.

## Validation Rules
- Poll must exist.
- Poll must be published.
- Poll must not be closed or expired.
- Answered questions must belong to the poll.
- `selectedOptionIndex` must map to a valid option.
- Mandatory questions must be present in the submitted answer set.

## Analytics Responsibility
- After successful response persistence, module computes poll analytics snapshot.
- Snapshot is published to Redis `responses.accepted` channel for socket fanout.
