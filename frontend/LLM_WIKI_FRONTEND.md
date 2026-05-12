# LLM Frontend Wiki

## Source of Truth
- This file is the persistent frontend execution log and decision tracker.
- Frontend work must reference and update this file only.

## Tech Stack
- Framework: Next.js (App Router)
- State: Zustand
- UI System: Radix + shadcn/ui
- Theme Direction: Mist / Yellow / Orange

## Feature-Driven Folder Structure
- `frontend/app/` -> Route-level pages and layouts (App Router)
- `frontend/features/` -> Feature-local state, business logic, and feature utilities
- `frontend/components/` -> Shared UI primitives and reusable layout components
- `frontend/lib/` -> Shared helpers and utilities

## 3-Step Execution Plan
1. Step 1 - Creator Dashboard UI (`Sidebar`, dashboard `Layout`, `/polls` page)
2. Step 2 - Poll Creation Flow UI (`/create`, question blocks, publish flow)
3. Step 3 - Analytics UI (`/analytics/[id]`, response insights and charts)

## Current Status
- Step 1: Completed
- Step 2: Pending
- Step 3: Pending

## Decisions Log
- Use dark, high-contrast dashboard shells with Mist surfaces and Yellow/Orange highlights.
- Step 1 delivered: shared dashboard shell, themed sidebar navigation, and creator `/polls` listing UI states (loading, empty, populated, and error).
