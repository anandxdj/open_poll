"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";

import { defaultLocale, type Locale } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

/**
 * The builder sits outside the live routes' intl provider, so the AI deck UI
 * brings its own for the `ai` namespace (same setup as `LiveIntlProvider`).
 */
export function AiIntlProvider({ locale = defaultLocale, children }: { locale?: Locale; children: ReactNode }) {
  const messages = useMemo(() => pickMessages(locale, ["ai"]), [locale]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
