---
summary: React Query, server actions, and HTTP interaction rules.
status: active
last_updated: 2026-05-13
---

# Data Fetching

## API Integration
- Utilize standard Next.js `fetch` with App Router caching semantics, or dedicated API client abstractions built around the backend's REST contracts.
- **Rule**: Never hallucinate backend endpoints. If unsure about the shape of the data, strictly refer to backend docs.

## Implementation Flow
- **Server Components**: Prefer native async/await `fetch()` within `page.tsx` for initial page loads with proper cache invalidation tags.
- **Mutations**: Use Next.js Server Actions for forms/mutations directly from Server Components where applicable.
- **Client Fetching**: For client-heavy polling or pagination, use Route Handlers (`app/api/`) or direct fetches to the Backend server URL mapped in `features/*/api/`.