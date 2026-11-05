import type { PresentationDraftInput } from "../../api/crud";
import { blankSlide, normalizeSlideForDraft, validateSlide } from "../../slides/editor";
import { slideTypeMeta } from "../../slides/meta";
import type { PresentationSlide } from "../../types/deck";
import type { DeckThemeRef } from "@/features/themes/types";

/** What the builder edits: deck-level fields plus the slide list. */
export interface DeckDraft {
  title: string;
  slides: PresentationSlide[];
  /** The saved deck's id; null until the first save. */
  id?: string | null;
  /** The saved deck's theme; the Theme tab saves it on its own (not part of drafts). */
  theme?: DeckThemeRef | null;
}

/**
 * The first slide of a new deck: a plain poll question (0 points, no correct
 * option), so a deck can be presented without marking an answer. "Graded" in
 * the inspector turns it into a quiz question.
 */
export const firstSlide = (): PresentationSlide => {
  const slide = blankSlide("select_answer");
  return { ...slide, points: 0, options: slide.options.map((o) => ({ ...o, isCorrect: false })) };
};

// ---------- Local (browser) draft ----------

export const buildDraftStorageKey = (presentationId: string | null) =>
  presentationId ? `openpoll_presentation_draft_${presentationId}` : "openpoll_presentation_draft_new";

/**
 * `savedAt` (ms) lets a reload tell unsaved local edits from an older copy of the saved deck;
 * `revision` is the saved deck's revision the edits started from, so restoring them never
 * overwrites a save someone else made meanwhile (the next save gets the conflict instead).
 */
export type PersistedPresentationDraft = DeckDraft & { active: number; savedAt?: number; revision?: number };

/**
 * Identity of a deck's editable content (title and slides). Equal signatures
 * mean no unsaved edit: the builder keeps no local draft and sends no save for
 * them (a save would bump the revision for nothing and make a co-editor's
 * next save look stale).
 */
export const deckSignature = (title: string, slides: PresentationSlide[]) => JSON.stringify({ title: title.trim(), slides });

/** A local draft written after the server copy holds edits not saved yet (a reload, a crash). */
export const draftIsNewer = (draft: PersistedPresentationDraft | null, serverUpdatedAt: string) =>
  !!draft?.savedAt && draft.savedAt > Date.parse(serverUpdatedAt);

export function loadDraft(storageKey: string): PersistedPresentationDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPresentationDraft;
    if (!parsed || typeof parsed.title !== "string" || !Array.isArray(parsed.slides)) {
      return null;
    }
    return {
      title: parsed.title,
      slides: parsed.slides,
      active: typeof parsed.active === "number" ? parsed.active : 0,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : undefined,
      revision: typeof parsed.revision === "number" ? parsed.revision : undefined,
    };
  } catch {
    return null;
  }
}

export function saveDraft(storageKey: string, draft: PersistedPresentationDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {}
}

export function clearDraft(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {}
}

// ---------- Validation and payloads ----------

/** First blocking error for an explicit save, or null. Expects cleaned slides. */
export function validateDeck(title: string, slides: PresentationSlide[]): string | null {
  if (!title.trim()) return "Give your presentation deck a title.";
  for (let i = 0; i < slides.length; i++) {
    const error = validateSlide(slides[i]);
    if (error) return `Slide ${i + 1}: ${error}`;
  }
  return null;
}

/**
 * Explicit save: slides must already pass `validateDeck`. Slides keep their `_id`:
 * the API keeps the ids of stored slides (co-editors and the slide-level routes
 * address slides by id) and gives new slides and unknown ids fresh ones.
 */
export function toSavePayload(title: string, cleanedSlides: PresentationSlide[]): PresentationDraftInput {
  return { title: title.trim(), slides: cleanedSlides };
}

/** Silent/draft save: fills gaps so an unfinished deck still passes the API rules. */
export function toDraftPayload(title: string, slides: PresentationSlide[]): PresentationDraftInput {
  return {
    title: title.trim() || "Untitled Presentation Deck",
    slides: slides.map(normalizeSlideForDraft),
  };
}

// ---------- Dirtiness and AI merge ----------

export function isSlideDirty(s: PresentationSlide): boolean {
  return Boolean(
    s.question.trim() ||
      s.options.some((o) => o.text.trim()) ||
      s.acceptedAnswers.length > 0 ||
      s.statements.some((st) => st.trim()) ||
      s.items.some((it) => it.trim()) ||
      slideTypeMeta(s.type).summary?.(s).trim()
  );
}

export function isDeckDirty(title: string, slides: PresentationSlide[]): boolean {
  if (title.trim()) return true;
  return slides.some(isSlideDirty);
}

// AI generation can take a while — if the user is meanwhile adding their own
// slides, applying the AI result must not wipe that work. Keep whatever the
// user actually typed and append the generated slides after it; only replace
// outright when there was nothing but the initial blank placeholder.
export function mergeGeneratedSlides(prev: PresentationSlide[], generated: PresentationSlide[]): PresentationSlide[] {
  const meaningful = prev.filter(isSlideDirty);
  return meaningful.length > 0 ? [...meaningful, ...generated] : generated;
}
