---
summary: Import UI - the library's Import dialog (PowerPoint/PDF upload, Google Slides link, CSV/Excel questions with a preview), the builder's "Import questions", job polling, disabled-mode explanations from capabilities.
status: active
last_updated: 2026-10-19
---

# Imports (`features/imports/`)

Backend contract: `backend/docs/wiki/modules/imports.md`. Entry points:

- **Library** (`/polls`): the "Import" button in `LibraryView`'s header (between New poll and New deck) opens
  `ImportDialog`. Every import creates a **new deck**; the result links to the builder
  (`/presentation/create?id=`).
- **Builder**: "Import questions" in `BuilderHeader` (one optional prop, `onImportQuestions`) opens
  `ImportQuestionsDialog`. The file is checked on the server (`mode=preview`, which also returns the parsed
  slides) and the slides go through the builder's own `handleGenerated` (the AI-draft path: kept slides stay, new ones
  are appended, the deck is saved as a draft), so nothing writes behind the builder's back; the dialog stays open with a confirmation and a Done button. The deck's room
  (50 slides minus the ones with content) caps what is added.

| File | Role |
|---|---|
| `types.ts` | Wire types: `ImportJob`, `QuestionsResult`, row errors, warnings. |
| `logic.ts` | Pure rules, unit tested (`tests/unit/imports.logic.test.ts`): `classifySourceFile` (.pptx/.pdf by extension, 100 MB), `classifyQuestionFile` (.csv/.xlsx, 2 MB), `parseGoogleSlidesLink` (mirrors the backend rule), `pollImportJob` (follows a job: quick polls settling at 3 s, tolerates 4 failed reads, gives up after 15 min; the job keeps running on the server), `deckHref`. |
| `api/imports.api.ts` | `uploadImportSource` (presign flow of `features/media`, purpose `import_source`, declares the type the server expects even when the browser leaves `.pptx` untyped), `createImport`, `getImport`, `sendQuestions` (multipart), `downloadQuestionsTemplate`, `getImportErrorCode`. |
| `hooks/useImportCapabilities.ts` | `GET /api/capabilities` once per page load → `{known, storage, pptxHighFidelity, googleDriveImport}`. While `known` is false nothing is claimed and the server has the final word. |
| `hooks/useImportRun.ts` | One file/link import: upload → create job → poll. States `idle · uploading · submitting · tracking · done · failed`; unmounting stops following. `describeImportError` maps API codes to sentences (`errors.*` in the messages). |
| `hooks/useQuestionsImport.ts` | Questions: choose a file → server preview → submit (`mode=import`). States `idle · checking · preview · importing · done · error`. |
| `components/ImportDialog.tsx` | Radix dialog with three tabs (`role=tablist`, arrow keys): `FilePanel`, `GooglePanel`, `QuestionsPanel`. `ImportButton` mounts it fresh on every open. |
| `components/QuestionsPanel.tsx` | Template downloads (through the API client, as blobs), file chooser, `QuestionsPreview` (table of questions + the rows that will be skipped, each with its reason), deck title, import. Two targets: `newDeck` (server creates it) and `localDeck` (builder). |
| `components/JobStatus.tsx` | Progress bar, queued/running stage, success with the deck link and the warnings list ("things to check"), failure with the reason and Try again. |
| `ImportIntlProvider.tsx` | next-intl scope (`messages/en/imports.json`, namespace `imports`); the dashboard has no app-wide provider yet. Components use `useTranslations("imports")`. |

## Disabled mode (from `GET /api/capabilities`)

| Capability off | What the person sees |
| --- | --- |
| `storage` | File tab: "File uploads are not set up" with the reason; the chooser and the button are disabled. Google tab: a note that pictures are not imported. Questions work without storage. |
| `pptxHighFidelity` | File tab note: charts, SmartArt and videos cannot be imported (their slides keep text and warn). On: slides with them import as a picture. |
| `googleDriveImport` | Google tab note: only "Anyone with the link" presentations import. On: private Drive files are importable through the API; the **Google Picker is not built into the app yet**, so the UI still asks for a link. |

Server-side limits show as messages from the API (plan limit, permission, queue down). Every failure that the file or link causes
(`INVALID_PPTX`, `PDF_ENCRYPTED`, `GSLIDES_PRIVATE`, …) arrives as a readable `error.message` on the failed job and is shown as is.

## Tests

- `tests/unit/imports.logic.test.ts`, `tests/unit/imports.ui.test.tsx` (panels per capability, preview table, job states, error wording).
- `e2e/imports.spec.ts` (signs in once per worker and builds its own `host` on that session, because the API allows
  10 sign-ins per 5 minutes per IP and the shared `host` fixture signs in per test; it also sets the `auth_session`
  cookie with `addCookies`, since the proxy guards `/polls` and `/presentation/create` before any page script runs): CSV → deck with the right slides (skipped rows explained, deck verified through the API), template
  downloads, refused file types, the storage-off explanation (the e2e backend has no `S3_*`), and questions added to a deck open
  in the builder.
