---
summary: Poll data model, response modes, expiry rules, and creator-facing status logic.
status: active
last_updated: 2026-05-13
---

# Polls Feature

## Poll Data Model

The `Poll` interface (from `features/polls/store/useCreatorStore.ts`) maps to the backend Mongoose schema:

```ts
interface Poll {
  _id: string;
  title: string;
  isAnonymous: boolean;       // true = anonymous mode, false = authenticated mode
  expiresAt: string;          // ISO 8601 datetime — responses blocked after this
  isPublished: boolean;       // false = draft, true = live
  isClosed?: boolean;         // manually closed by creator
  isResultsPublished?: boolean; // true = results visible publicly via poll link
  questions: {
    _id?: string;
    text: string;
    options: string[];        // array of choice labels (2–10 options)
    isMandatory: boolean;     // true = voter must answer before submitting
  }[];
  createdAt: string;
}
```

## Response Modes

| Mode | `isAnonymous` value | Behavior |
|---|---|---|
| Anonymous | `true` | No identity collected. Device ID only for anti-spam. |
| Authenticated | `false` | Respondent must enter name + email before voting. Stored with response. |

> MVP Note: "Authenticated" does not mean session auth. It means an identity gate (name/email form) is shown to the respondent before the questions are displayed.

## Expiry System

- `expiresAt` is set during poll creation (datetime-local picker).
- Status helper `pollStatus(poll)`:
  - `"draft"` → `isPublished === false`
  - `"expired"` → `isClosed === true` OR `new Date(expiresAt) <= Date.now()`
  - `"active"` → published, not closed, not expired
- The respondent voting page (`/p/[id]`) must check expiry on load and block voting if expired.
- Backend also enforces expiry on response submission routes.

## Poll Status Logic

```ts
function pollStatus(poll: Poll): "active" | "expired" | "draft" {
  if (!poll.isPublished) return "draft";
  const closed = poll.isClosed === true;
  const expired = new Date(poll.expiresAt).getTime() <= Date.now();
  if (closed || expired) return "expired";
  return "active";
}
```

## Expiry Countdown Badge

PollCards display a human-readable countdown for active polls, e.g., "Closes in 2h 14m".

## Publish Results

- `isResultsPublished` is a toggle on the poll analytics page.
- When `true`, the public poll link (`/p/[id]`) shows a results summary after the respondent votes (or after expiry).
- Creator triggers this via a "Publish Results" button in the analytics view or on the PollCard.

## Mandatory / Optional Validation

- `isMandatory: true` → respondent must select an option before submitting.
- `isMandatory: false` → question is optional; respondent can skip.
- Frontend validation: the Submit button is disabled or inline errors shown if mandatory questions are unanswered.
- Backend validation: the response submission route enforces mandatory fields using Zod schema.

## Question Rules

- Each poll supports multiple questions (no hard limit shown in UI, but each question is single-option / radio-select).
- Options: minimum 2, maximum 10 per question.
- Question text: minimum 3 characters.