/**
 * Query parameter the builder is opened with after a mock-mode generation
 * (`/presentation/create?id=<deck>&aiSource=mock`): it keeps the "generated with
 * mock data" notice on the deck until the author dismisses it.
 */
export const AI_SOURCE_PARAM = "aiSource";

/** Search params for the builder after a generation; `base` keeps the ones already there. */
export function builderParamsAfterGeneration(base: URLSearchParams, deckId: string, source: "llm" | "mock"): URLSearchParams {
  const params = new URLSearchParams(base);
  params.set("id", deckId);
  // The seed (`name`, `mode=ai`) only starts a new deck.
  params.delete("name");
  params.delete("mode");
  if (source === "mock") params.set(AI_SOURCE_PARAM, "mock");
  else params.delete(AI_SOURCE_PARAM);
  return params;
}
