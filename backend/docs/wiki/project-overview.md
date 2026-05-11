---
summary: Backend MVP scope and product behavior for open poll platform.
status: active
last_updated: 2026-05-11
---

# Project Overview

Open Poll is a backend-first, real-time polling platform where creators publish polls and respondents submit step-based answers. The MVP intentionally excludes auth and uses mocked creator identity while preserving domain boundaries for later auth integration.

## MVP Includes
- Poll lifecycle APIs (create, read, list, update, close).
- Response submission APIs with mandatory/optional rule enforcement.
- Real-time analytics fanout using Redis pub/sub and Socket.io rooms.
- AI poll generation using Gemini via LangChain + LangGraph with structured output.
