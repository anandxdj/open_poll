"use client";

import { useMemo, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { defaultLocale } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

/** next-intl provider for the billing page (the dashboard has none). English only for now. */
export function BillingIntlProvider({ children }: { children: ReactNode }) {
  const messages = useMemo(() => pickMessages(defaultLocale, ["billing"]), []);
  return (
    <NextIntlClientProvider locale={defaultLocale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}
