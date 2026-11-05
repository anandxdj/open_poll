import type { PresentationDraftInput } from "../../api/crud";
import { normalizeSlideForDraft, validateSlide } from "../../slides/editor";
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

// ---------- Local (browser) draft ----------

export const buildDraftStorageKey = (presentationId: string | null) =>
  presentationId ? `openpoll_presentation_draft_${presentationId}` : "openpoll_presentation_draft_new";

export type PersistedPresentationDraft = DeckDraft & { active: number };

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
    };
  } catch {
    return null;
  }
}

export function saveDraft(storageKey: string, draft: PersistedPresentationDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(draft));
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

/** Payload shape for create/update: the API assigns slide ids itself. */
export function withoutSlideId(s: PresentationSlide): Omit<PresentationSlide, "_id"> {
  const rest: Partial<PresentationSlide> = { ...s };
  delete rest._id;
  return rest as Omit<PresentationSlide, "_id">;
}

/** Explicit save: slides must already pass `validateDeck`. */
export function toSavePayload(title: string, cleanedSlides: PresentationSlide[]): PresentationDraftInput {
  return { title: title.trim(), slides: cleanedSlides.map(withoutSlideId) };
}

/** Silent/draft save: fills gaps so an unfinished deck still passes the API rules. */
export function toDraftPayload(title: string, slides: PresentationSlide[]): PresentationDraftInput {
  return {
    title: title.trim() || "Untitled Presentation Deck",
    slides: slides.map(normalizeSlideForDraft).map(withoutSlideId),
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
