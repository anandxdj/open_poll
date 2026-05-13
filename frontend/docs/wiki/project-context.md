# Project Context

## What We Are Doing
Open Poll is a platform designed to create and manage dynamic, real-time polls. It is a full-stack, real-time polling platform where creators build and publish polls, and respondents submit single-choice answers. The project features a modern, high-end "Double-Bezel" dashboard architecture with a cinematic user experience inspired by tools like Mentimeter.

## Our Agenda
- **Premium User Experience**: Deliver a cinematic polling experience with strict adherence to high-quality design standards and an agency-tier aesthetic. The poll builder is Mentimeter-inspired with a two-panel live-preview layout.
- **Spec-Driven Development (SDD)**: Strictly adhere to SDD constraints. All tasks must begin by consulting the relevant `context-router.md` to ensure correct specifications are followed.
- **Backend-First Architecture**: Implement modular domain-first backend services for poll lifecycles and response submission (with mandatory/optional rule enforcement).
- **Real-Time Analytics**: Support live voting updates and analytics fanout using Redis pub/sub and Socket.io rooms.
- **AI Integration**: Provide AI-assisted poll generation workflows using Gemini, LangChain, and LangGraph with structured output.
- **MVP Auth**: MVP uses mocked creator identity. "Authenticated" response mode means respondents provide name/email before voting (no full session auth yet).

## Product Rules
- **Single-option polls only**: Each question supports radio-select (one answer per respondent).
- **Response modes**: Polls support `Anonymous` (no identity collected) and `Authenticated` (name/email required before voting) modes.
- **Expiry system**: Every poll has an `expiresAt` timestamp; responses are blocked after expiry.
- **Mandatory/optional validation**: Each question has an `isMandatory` flag; frontend enforces this on the respondent voting page.
- **Creator analytics**: Poll creators have a full analytics dashboard — response counts, option summaries, participation insights, and per-question breakdowns.
- **Publish results**: Creators can publish final poll results publicly; they are viewable via the same poll link after completion.
- **Real-time updates**: WebSockets / Socket.io power live response counts and analytics updates.

## Core Technologies
- **Frontend Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS (with specific Double-Bezel and Amber themes)
- **Backend Environment**: Bun, Express.js, TypeScript, Zod
- **Database**: MongoDB (via Mongoose)
- **Real-time & Caching**: WebSockets / Socket.io, Redis
- **AI**: Gemini API via LangChain & LangGraph
- **State/Identity Management**: LocalStorage for device IDs (anti-spam) and React state management

*(This document should be updated as the project's vision evolves.)*
