import type { DeckKindInfo } from "./types";

/** Kinds with a translated label in `messages/en/ai.json` (`deck.kinds`); others show their key. */
export const KNOWN_KIND_LABELS = [
  "heading",
  "paragraph",
  "bullets",
  "quote",
  "big_number",
  "multiple_choice_quiz",
  "type_answer",
  "multiple_choice_poll",
  "wordcloud",
  "open_ended",
  "scales",
  "ranking",
] as const;

export type KnownKind = (typeof KNOWN_KIND_LABELS)[number];

export const isKnownKind = (kind: string): kind is KnownKind => (KNOWN_KIND_LABELS as readonly string[]).includes(kind);

/** `humanize("big_number") === "Big number"`: the fallback label for a kind this client has no text for. */
export const humanizeKind = (kind: string) => {
  const text = kind.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : kind;
};

/** The kind a "new slide" starts with: the first available one of a category the author asked for. */
export function defaultNewKind(kinds: readonly DeckKindInfo[], include: { content: boolean; polls: boolean; quiz: boolean }): string {
  const wanted = (kind: DeckKindInfo) =>
    (kind.category === "content" && include.content) || (kind.category === "poll" && include.polls) || (kind.category === "quiz" && include.quiz);
  return (kinds.find(wanted) ?? kinds[0])?.kind ?? "bullets";
}
