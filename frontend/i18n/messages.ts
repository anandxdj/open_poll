import type { Locale } from "./config";
import ai from "@/messages/en/ai.json";
import live from "@/messages/en/live.json";
import sessions from "@/messages/en/sessions.json";

/**
 * English messages by namespace, one file per feature under
 * `messages/<locale>/<feature>.json`. Append-only: one line per namespace,
 * alphabetical. The shape types every `useTranslations` key (see global.d.ts).
 */
export const enMessages = {
  ai,
  live,
  sessions,
};

export type Messages = typeof enMessages;
export type Namespace = keyof Messages;

const byLocale: Record<Locale, Messages> = {
  en: enMessages,
};

/** The given namespaces of a locale's messages (falls back to English per namespace). */
export function pickMessages<N extends Namespace>(locale: Locale, namespaces: readonly N[]): Pick<Messages, N> {
  const source = byLocale[locale] ?? enMessages;
  const picked = {} as Pick<Messages, N>;
  for (const ns of namespaces) picked[ns] = source[ns] ?? enMessages[ns];
  return picked;
}
