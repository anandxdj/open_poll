"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { defaultLocale, type Locale } from "./config";
import { pickMessages } from "./messages";

/**
 * Client-side next-intl provider for the live routes (`/live/**`,
 * `/presentation/host/**`). Messages ship with the client bundle, so it needs
 * no request config or `next.config` plugin. English only until W4 adds
 * locales; the participant's browser language picks among them then.
 */
export function LiveIntlProvider({ locale = defaultLocale, children }: { locale?: Locale; children: ReactNode }) {
  const messages = useMemo(() => pickMessages(locale, ["live", "presenter", "slidesAdvanced"]), [locale]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
