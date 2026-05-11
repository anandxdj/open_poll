---
summary: Redis pub/sub channels used by real-time analytics path.
status: active
last_updated: 2026-05-11
---

# Redis Channels

Current channels:
- `analytics:update`: published by analytics worker after Mongo aggregate sync and cache refresh.

Processing path:
1. Responses service writes buffered counters to Redis keys and adds poll id to `buffer:active_polls`.
2. 2-second analytics worker applies one Mongo `bulkWrite` to analytics docs and clears buffer keys.
3. Worker deletes analytics cache and publishes event JSON to `analytics:update`.
4. Socket subscriber receives event and emits `analytics:update` to room `poll_{pollId}`.
