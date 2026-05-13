---
summary: Local storage, device tracking, and React state constraints.
status: active
last_updated: 2026-05-13
---

# Client State & Context

## Device Identity
- **Anonymous Tracking**: `deviceId` is stored under `openpoll_device_id` in `localStorage` for anonymous/guest tracking.
- Do not rely on server sessions for unauthenticated users voting on public polls. All voting must send this stored `deviceId`.

## React State
- Prefer localized component state (`useState`, `useReducer`) over heavy global stores.
- Use URL parameters / Query Strings for shareable state (e.g., active tabs, filters) to ensure immediate link sharability.
- Global Providers should wrap only what is necessary in the tree (e.g., ThemeProvider).