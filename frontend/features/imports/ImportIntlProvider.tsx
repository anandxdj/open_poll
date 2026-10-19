"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { pickMessages } from "@/i18n/messages";

/**
 * next-intl scope for the import UI (the dashboard has no app-wide provider
 * yet). Messages ship with the client bundle; English only until W4-B adds
 * locales.
 */
export function ImportIntlProvider({ children }: { children: ReactNode }) {
  const messages = useMemo(() => pickMessages("en", ["imports"]), []);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
