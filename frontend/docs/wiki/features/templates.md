---
summary: The templates page at /templates — starter decks and workspace templates, Use template, and the Save as template dialog (W3-B2).
status: active
last_updated: 2026-11-05
---

# Templates (`features/templates/`)

`/templates` (`app/(dashboard)/templates/page.tsx`, sidebar item "Templates" between Library and
Analytics, protected by the proxy like the other app pages). Backend: `GET|POST /api/templates`,
`POST /api/templates/:id/use`, `DELETE /api/templates/:id`
(`backend/docs/wiki/modules/folders-templates.md`).

| File | Role |
| --- | --- |
| `api.ts` | `TemplateSummary` / `TemplateList` wire types; `listTemplates`, `saveAsTemplate(deckId, title)`, `createDeckFromTemplate(id)`, `deleteTemplate(id)`; `TEMPLATES_PATH`. |
| `components/TemplatesView.tsx` | The page: h1 "Templates", **Starter templates** (the four decks shipped with the app: Team retro, Conference talk with Q&A, Classroom quiz, All-hands pulse) and **Saved in this workspace** (empty state explains Save as template). Each card: a graph-paper preview with the category and a dark mini screen of slide-type icons, title, slide count (and who saved it, when), the description (starters), the first four slide labels, and **Use template** (`ink`). Workspace templates have a menu with **Delete template** (the app's AlertDialog; decks made from it stay). Refetches when the workspace changes. |
| `components/TemplateNotice.tsx` | The builder's state for a template opened by a direct link (below). |
| `components/SaveAsTemplateDialog.tsx` | Used by the library card menu (decks): the template's name (default: the deck title, ≤120), Save template, toast with a link here. Errors show under the field. |

- **Use template** creates a draft deck in the current workspace and opens it in the builder
  (`/presentation/create?id=`); a starter's deck is titled like the template ("Team retro"), a
  workspace template's deck takes the template's name.
- Who sees what: everyone in the workspace sees both lists; Use template and Delete need owner, admin
  or editor (`useCanOrganizeLibrary` from `features/library`); other roles see the buttons disabled
  and a one-line note under the heading.
- Templates are not library items: a saved template never shows in `/polls`, its counts or search.
- **Direct links** to a workspace template: the API refuses to present one (409
  `TEMPLATE_NOT_PRESENTABLE`). The host console (`/presentation/host/<id>`, `HostConsole.tsx`, strings
  `presenter.template.*`) shows "This is a template" with **Use template** (creates the deck, opens the
  builder) and **Back to templates** instead of the ready screen; the builder
  (`/presentation/create?id=<id>`) shows `components/TemplateNotice.tsx` instead of the editor (Use
  template makes the deck and reloads the builder on it; nothing is saved to the template on the way out).
- Tests: `e2e/templates.spec.ts`.
