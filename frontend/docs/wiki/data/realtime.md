---
summary: WebSocket hook structure and live analytics event flow.
status: active
last_updated: 2026-05-13
---

# Realtime & WebSockets

## Socket Configuration
- We use the standard Socket.io client.
- **Connection**: Initialize the connection only when entering a realtime domain (e.g., Live Analytics screen). Ensure component unmount completely disconnects the socket.

## Poll Live Sockets
- **Rooms**: Socket rooms join/leave with raw `pollId` strings. This must exactly match the backend `socket.gateway.ts`.
- **Events**: Listen for vote increments and dynamically merge the state into the analytics data structure without causing full page reloads.