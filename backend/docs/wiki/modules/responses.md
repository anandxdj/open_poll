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

## Vote Integrity
- Every submit spends a single-use, HMAC-signed ballot bound to the poll
  (`POST /responses/poll/:pollId/ballot`). Spent-ballot markers are claimed
  with atomic `SET NX` and outlive the poll's expiry. `deviceId` is a hint only.
- `respondentId` comes only from `req.user.id` or a server-signed guest token
  (`POST /responses/guest-token`). Body `respondentId` / `guest:` strings are
  ignored. Non-anonymous polls require one of the two.
- Polls: one vote per identity (atomic `SET NX`); identity-less votes persist
  as `anon:<ballotId>` and are capped per IP per poll.
- Trials: each retry fetches a fresh ballot. Identified respondents may retry
  until they pass; attempts are serialized by a short per-respondent lock.
- Ballot, guest-token and submit routes are rate-limited per IP.

## Plan response cap
- A poll accepts at most its workspace plan's `audienceCap` responses (`modules/billing.md`,
  "Poll response cap"): a full poll answers 403 `PLAN_LIMIT_REACHED` before a ballot or identity
  marker is spent. The slot is taken atomically after the dedup claims (trial attempts count).

## Analytics Responsibility
- After successful response persistence, module computes poll analytics snapshot.
- Snapshot is published to Redis `responses.accepted` channel for socket fanout.
