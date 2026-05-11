---
summary: Redis pub/sub channels used by real-time analytics path.
status: active
last_updated: 2026-05-11
---

# Redis Channels

Current channels:
- `responses.accepted`: published after response persistence with latest poll analytics snapshot.

Processing path:
1. Responses service publishes event JSON to `responses.accepted`.
2. Redis subscriber receives event.
3. Socket gateway emits `analytics:update` to `pollId` room.
