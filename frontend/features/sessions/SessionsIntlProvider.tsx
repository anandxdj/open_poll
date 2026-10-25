"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { defaultLocale, type Locale } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

/**
 * Client-side next-intl provider for the sessions screens. Besides `sessions`
 * it carries `live`: the report draws each slide with the slide types' own
 * StageViews, whose strings live there. Nested inside the live layout's
 * provider on `/live/[code]/summary`, where it replaces the live-only set.
 */
export function SessionsIntlProvider({ locale = defaultLocale, children }: { locale?: Locale; children: ReactNode }) {
  const messages = useMemo(() => pickMessages(locale, ["live", "sessions"]), [locale]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
